import React, { useState, useEffect, useCallback } from 'react';

// =======================
// Core Data Models
// =======================
const NodeModel = (id, name, x, y, width = 100, height = 70) => ({
  id, name, x, y, width, height
});

// Channel: orientation is 'horizontal' or 'vertical'
const ChannelModel = (id, orientation, position, start, end) => ({
  id, orientation, position, start, end
});

// Cable: forcedChannels (optional) forces the cable to use one or more channels
const CableModel = (id, name, sourceNodeId, targetNodeId, forcedChannels = []) => ({
  id, name, sourceNodeId, targetNodeId, forcedChannels, route: []
});

// =======================
// Constants
// =======================
const MIN_PERPENDICULAR_LENGTH = 30; // base distance to leave the node
const EXIT_OFFSET = 2; // extra gap so cables don't hug the node edge
const CABLE_SPACING = 3; // increased spacing for overlapping segments
const HORIZONTAL_ALIGNMENT_THRESHOLD = 20; // when nodes are nearly horizontally aligned

// =======================
// Utility Functions
// =======================
const getNodeBounds = (node) => ({
  left: node.x - node.width / 2,
  right: node.x + node.width / 2,
  top: node.y - node.height / 2,
  bottom: node.y + node.height / 2
});

const getNodeEdges = (node) => {
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  return {
    top: { x: node.x, y: node.y - halfHeight },
    right: { x: node.x + halfWidth, y: node.y },
    bottom: { x: node.x, y: node.y + halfHeight },
    left: { x: node.x - halfWidth, y: node.y }
  };
};

// Check if an orthogonal segment (horizontal or vertical) intersects a node (with optional padding)
const doesSegmentIntersectNode = (start, end, node, padding = 0) => {
  // Ensure we're dealing with orthogonal segments
  if (start.x !== end.x && start.y !== end.y) return false;
  
  const bounds = getNodeBounds(node);
  bounds.left -= padding;
  bounds.right += padding;
  bounds.top -= padding;
  bounds.bottom += padding;
  
  if (start.y === end.y) {
    const y = start.y;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return y >= bounds.top && y <= bounds.bottom && maxX >= bounds.left && minX <= bounds.right;
  }
  if (start.x === end.x) {
    const x = start.x;
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return x >= bounds.left && x <= bounds.right && maxY >= bounds.top && minY <= bounds.bottom;
  }
  return false;
};

const determineOptimalEdges = (sourceNode, targetNode) => {
  const dx = targetNode.x - sourceNode.x;
  const dy = targetNode.y - sourceNode.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  let sourceEdge, targetEdge;
  
  // Check if nodes are roughly aligned horizontally or vertically
  const isHorizontallyAligned = absDy < HORIZONTAL_ALIGNMENT_THRESHOLD;
  const isVerticallyAligned = absDx < HORIZONTAL_ALIGNMENT_THRESHOLD;
  
  if (isHorizontallyAligned && !isVerticallyAligned) {
    // Nodes are horizontally aligned, use left/right edges
    sourceEdge = dx > 0 ? 'right' : 'left';
    targetEdge = dx > 0 ? 'left' : 'right';
  } else if (!isHorizontallyAligned && isVerticallyAligned) {
    // Nodes are vertically aligned, use top/bottom edges
    sourceEdge = dy > 0 ? 'bottom' : 'top';
    targetEdge = dy > 0 ? 'top' : 'bottom';
  } else if (absDx > absDy) {
    // More horizontal separation
    sourceEdge = dx > 0 ? 'right' : 'left';
    targetEdge = dx > 0 ? 'left' : 'right';
  } else {
    // More vertical separation
    sourceEdge = dy > 0 ? 'bottom' : 'top';
    targetEdge = dy > 0 ? 'top' : 'bottom';
  }
  
  return { sourceEdge, targetEdge };
};

// Compute a connection point along a node edge (exactly at the node border)
const calculateConnectionPoint = (node, edge, index, total, forceCenter = false) => {
  const edges = getNodeEdges(node);
  let basePoint = { ...edges[edge] };
  
  if (!forceCenter && total > 1) {
    const edgeLength = (edge === 'top' || edge === 'bottom') ? node.width : node.height;
    const maxOffset = Math.min(edgeLength * 0.4, 30);
    const spacing = (2 * maxOffset) / (total + 1);
    const offset = (index + 1) * spacing - maxOffset;
    
    if (edge === 'top' || edge === 'bottom') {
      basePoint.x += offset;
      // Keep y exactly on the edge
      basePoint.y = edges[edge].y;
    } else {
      basePoint.y += offset;
      // Keep x exactly on the edge
      basePoint.x = edges[edge].x;
    }
  }
  
  return basePoint;
};

// Ensure a route consists only of orthogonal segments
const ensureOrthogonalRoute = (route) => {
  if (route.length <= 2) return route;
  
  const result = [route[0]];
  for (let i = 1; i < route.length; i++) {
    const prev = result[result.length - 1];
    const curr = route[i];
    
    // If the segment is already orthogonal, just add the current point
    if (prev.x === curr.x || prev.y === curr.y) {
      result.push(curr);
    } else {
      // If the segment is diagonal, add an intermediate point to create orthogonal segments
      // Choose direction based on which has larger delta (horizontal first if dx >= dy)
      const dx = Math.abs(curr.x - prev.x);
      const dy = Math.abs(curr.y - prev.y);
      
      if (dx >= dy) {
        result.push({ x: curr.x, y: prev.y });
      } else {
        result.push({ x: prev.x, y: curr.y });
      }
      result.push(curr);
    }
  }
  
  return result;
};

// Preserve source and target connection points in a route
const preserveConnectionPoints = (route, sourcePoint, targetPoint) => {
  if (route.length < 2) return [sourcePoint, targetPoint];
  
  const result = [...route];
  result[0] = { ...sourcePoint };
  result[result.length - 1] = { ...targetPoint };
  
  // Ensure the segments adjacent to connection points are orthogonal
  if (result.length > 2) {
    // Fix first segment if needed
    if (result[0].x !== result[1].x && result[0].y !== result[1].y) {
      const dx = Math.abs(result[1].x - result[0].x);
      const dy = Math.abs(result[1].y - result[0].y);
      
      if (dx >= dy) {
        // Horizontal first
        result[1] = { x: result[1].x, y: result[0].y };
      } else {
        // Vertical first
        result[1] = { x: result[0].x, y: result[1].y };
      }
    }
    
    // Fix last segment if needed
    const lastIdx = result.length - 1;
    const prevIdx = lastIdx - 1;
    
    if (result[prevIdx].x !== result[lastIdx].x && result[prevIdx].y !== result[lastIdx].y) {
      const dx = Math.abs(result[lastIdx].x - result[prevIdx].x);
      const dy = Math.abs(result[lastIdx].y - result[prevIdx].y);
      
      if (dx >= dy) {
        // Horizontal first
        result[prevIdx] = { x: result[prevIdx].x, y: result[lastIdx].y };
      } else {
        // Vertical first
        result[prevIdx] = { x: result[lastIdx].x, y: result[prevIdx].y };
      }
    }
  }
  
  return result;
};

// Generate an orthogonal route between two nodes
const generateOrthogonalRoute = (sourceNode, targetNode, sourcePoint, targetPoint, sourceEdge, targetEdge) => {
  const route = [];
  
  // Source: connection point, then a perpendicular exit.
  route.push(sourcePoint);
  const sourceExit = { ...sourcePoint };
  switch(sourceEdge) {
    case 'top': sourceExit.y = sourcePoint.y - (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    case 'right': sourceExit.x = sourcePoint.x + (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    case 'bottom': sourceExit.y = sourcePoint.y + (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    case 'left': sourceExit.x = sourcePoint.x - (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    default: break;
  }
  route.push(sourceExit);
  
  // Target: compute an approach point, then finish exactly at the node edge.
  const targetApproach = { ...targetPoint };
  switch(targetEdge) {
    case 'top': targetApproach.y = targetPoint.y - (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    case 'right': targetApproach.x = targetPoint.x + (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    case 'bottom': targetApproach.y = targetPoint.y + (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    case 'left': targetApproach.x = targetPoint.x - (MIN_PERPENDICULAR_LENGTH + EXIT_OFFSET); break;
    default: break;
  }
  
  const isSourceVertical = sourceEdge === 'top' || sourceEdge === 'bottom';
  const isTargetVertical = targetEdge === 'top' || targetEdge === 'bottom';
  if (isSourceVertical === isTargetVertical) {
    // Same orientation – add an extra corner.
    if (isSourceVertical) {
      route.push({ x: targetApproach.x, y: sourceExit.y });
    } else {
      route.push({ x: sourceExit.x, y: targetApproach.y });
    }
  } else {
    // Different orientations – a single corner.
    route.push({
      x: isSourceVertical ? targetApproach.x : sourceExit.x,
      y: isSourceVertical ? sourceExit.y : targetApproach.y
    });
  }
  route.push(targetApproach);
  route.push(targetPoint); // Ensure termination exactly at the node edge.
  
  return route;
};

const createSimpleDetour = (start, end, node) => {
  // Ensure we're working with orthogonal segments
  if (start.x !== end.x && start.y !== end.y) {
    // Force orthogonality
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dx >= dy) {
      end = { x: end.x, y: start.y };
    } else {
      end = { x: start.x, y: end.y };
    }
  }
  
  const bounds = getNodeBounds(node);
  const padding = 20;
  const box = {
    left: bounds.left - padding,
    right: bounds.right + padding,
    top: bounds.top - padding,
    bottom: bounds.bottom + padding
  };
  
  // Determine if segment is horizontal or vertical
  const isHorizontal = start.y === end.y;
  
  if (isHorizontal) {
    const segmentY = start.y;
    const goAbove = segmentY <= node.y;
    const detourY = goAbove ? box.top - 10 : box.bottom + 10;
    return [start, { x: start.x, y: detourY }, { x: end.x, y: detourY }, end];
  } else {
    const segmentX = start.x;
    const goLeft = segmentX <= node.x;
    const detourX = goLeft ? box.left - 10 : box.right + 10;
    return [start, { x: detourX, y: start.y }, { x: detourX, y: end.y }, end];
  }
};

const avoidObstacles = (route, obstacles, sourceNodeId, targetNodeId) => {
  if (route.length < 2) return route;
  const relevantObstacles = obstacles.filter(node => node.id !== sourceNodeId && node.id !== targetNodeId);
  if (relevantObstacles.length === 0) return route;
  
  // First ensure route has only orthogonal segments
  let orthogonalRoute = ensureOrthogonalRoute(route);
  let result = [orthogonalRoute[0]];
  
  for (let i = 0; i < orthogonalRoute.length - 1; i++) {
    const start = orthogonalRoute[i];
    const end = orthogonalRoute[i + 1];
    
    // Skip zero-length segments
    if (start.x === end.x && start.y === end.y) {
      continue;
    }
    
    // Ensure orthogonality
    if (start.x !== end.x && start.y !== end.y) {
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      if (dx >= dy) {
        result.push({ x: end.x, y: start.y });
      } else {
        result.push({ x: start.x, y: end.y });
      }
      result.push(end);
      continue;
    }
    
    let intersectingNode = null;
    for (const node of relevantObstacles) {
      if (doesSegmentIntersectNode(start, end, node, 5)) {
        intersectingNode = node;
        break;
      }
    }
    
    if (intersectingNode) {
      const detour = createSimpleDetour(start, end, intersectingNode);
      // Skip the first point as it's already in the result
      for (let j = 1; j < detour.length; j++) {
        result.push(detour[j]);
      }
    } else {
      result.push(end);
    }
  }
  
  return simplifyRoute(result);
};

const simplifyRoute = (route) => {
  if (route.length <= 2) return route;
  const result = [route[0]];
  
  for (let i = 1; i < route.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = route[i];
    const next = route[i + 1];
    
    // Keep the point if removing it would create a non-orthogonal segment
    if (prev.x !== next.x && prev.y !== next.y) {
      result.push(curr);
      continue;
    }
    
    // Skip this point only if it's collinear with the previous and next points
    if ((prev.x === curr.x && curr.x === next.x) ||
        (prev.y === curr.y && curr.y === next.y)) {
      continue;
    }
    
    result.push(curr);
  }
  
  result.push(route[route.length - 1]);
  return result;
};

// Apply forced channels to a route
const applyForcedChannels = (sourcePoint, targetPoint, forcedChannelIds, channels) => {
  let forcedRoute = [sourcePoint];
  let currentPoint = { ...sourcePoint };
  forcedChannelIds.forEach((channelId) => {
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) return;
    if (channel.orientation === 'vertical') {
      forcedRoute.push({ x: channel.position, y: currentPoint.y });
      currentPoint = { x: channel.position, y: currentPoint.y };
    } else if (channel.orientation === 'horizontal') {
      forcedRoute.push({ x: currentPoint.x, y: channel.position });
      currentPoint = { x: currentPoint.x, y: channel.position };
    }
  });
  forcedRoute.push({ x: currentPoint.x, y: targetPoint.y });
  forcedRoute.push(targetPoint);
  
  // Ensure route is orthogonal and connection points are preserved
  forcedRoute = ensureOrthogonalRoute(forcedRoute);
  forcedRoute = preserveConnectionPoints(forcedRoute, sourcePoint, targetPoint);
  
  return simplifyRoute(forcedRoute);
};

// This helper attempts to "snap" segments to channels if beneficial
const useChannelsForRoute = (route, channels) => {
  let improvementsMade = true;
  let currentRoute = [...route];
  let iterations = 0;
  
  while (improvementsMade && iterations < 3) {
    improvementsMade = false;
    iterations++;
    
    // Ensure route is orthogonal at each iteration
    currentRoute = ensureOrthogonalRoute(currentRoute);
    
    for (let i = 0; i < currentRoute.length - 1; i++) {
      const start = currentRoute[i];
      const end = currentRoute[i + 1];
      
      // Skip non-orthogonal segments (should not happen due to ensureOrthogonalRoute)
      if (start.x !== end.x && start.y !== end.y) {
        continue;
      }
      
      // Skip short segments
      if (Math.abs(start.x - end.x) < 30 && Math.abs(start.y - end.y) < 30) {
        continue;
      }
      
      for (const channel of channels) {
        if (channel.orientation === 'horizontal' && start.y === end.y) {
          if ((start.y < channel.position && end.y < channel.position) ||
              (start.y > channel.position && end.y > channel.position)) continue;
              
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          
          if (minX < channel.start || maxX > channel.end) continue;
          
          const detour = [
            start,
            { x: start.x, y: channel.position },
            { x: end.x, y: channel.position },
            end
          ];
          
          // Validate that all segments in detour are orthogonal
          let isValid = true;
          for (let j = 0; j < detour.length - 1; j++) {
            if (detour[j].x !== detour[j + 1].x && detour[j].y !== detour[j + 1].y) {
              isValid = false;
              break;
            }
          }
          
          if (!isValid) continue;
          
          currentRoute.splice(i, 2, ...detour);
          i += detour.length - 2; // Adjust index to avoid processing new points
          improvementsMade = true;
          break;
        } else if (channel.orientation === 'vertical' && start.x === end.x) {
          if ((start.x < channel.position && end.x < channel.position) ||
              (start.x > channel.position && end.x > channel.position)) continue;
              
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);
          
          if (minY < channel.start || maxY > channel.end) continue;
          
          const detour = [
            start,
            { x: channel.position, y: start.y },
            { x: channel.position, y: end.y },
            end
          ];
          
          // Validate that all segments in detour are orthogonal
          let isValid = true;
          for (let j = 0; j < detour.length - 1; j++) {
            if (detour[j].x !== detour[j + 1].x && detour[j].y !== detour[j + 1].y) {
              isValid = false;
              break;
            }
          }
          
          if (!isValid) continue;
          
          currentRoute.splice(i, 2, ...detour);
          i += detour.length - 2; // Adjust index to avoid processing new points
          improvementsMade = true;
          break;
        }
      }
    }
  }
  
  // Ensure final route is orthogonal and simplified
  currentRoute = ensureOrthogonalRoute(currentRoute);
  return simplifyRoute(currentRoute);
};

// Adjust spacing for overlapping (collinear) segments
const applySpacingToCables = (cables, channels) => {
  const segmentMap = new Map();
  cables.forEach(cable => {
    const route = cable.route || [];
    for (let i = 0; i < route.length - 1; i++) {
      const start = route[i];
      const end = route[i + 1];
      
      // Skip zero-length or diagonal segments
      if ((start.x === end.x && start.y === end.y) ||
          (start.x !== end.x && start.y !== end.y)) continue;
          
      const isVertical = (start.x === end.x);
      const position = isVertical ? start.x : start.y;
      const min = isVertical ? Math.min(start.y, end.y) : Math.min(start.x, end.x);
      const max = isVertical ? Math.max(start.y, end.y) : Math.max(start.x, end.x);
      const positionKey = Math.round(position / 5) * 5;
      const orientationKey = isVertical ? 'v' : 'h';
      const key = `${orientationKey}-${positionKey}`;
      
      if (!segmentMap.has(key)) segmentMap.set(key, []);
      segmentMap.get(key).push({
        cableId: cable.id,
        segmentIndex: i,
        min,
        max,
        start: { ...start },
        end: { ...end }
      });
    }
  });
  
  for (const [key, segments] of segmentMap.entries()) {
    if (segments.length <= 1) continue;
    segments.sort((a, b) => a.min - b.min || a.max - b.max);
    const overlappingGroups = [];
    let currentGroup = [segments[0]];
    let currentMax = segments[0].max;
    
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.min <= currentMax) {
        currentGroup.push(segment);
        currentMax = Math.max(currentMax, segment.max);
      } else {
        overlappingGroups.push([...currentGroup]);
        currentGroup = [segment];
        currentMax = segment.max;
      }
    }
    
    if (currentGroup.length > 0) overlappingGroups.push(currentGroup);
    
    overlappingGroups.forEach(group => {
      const isVertical = key.startsWith('v');
      const count = group.length;
      const spacing = CABLE_SPACING;
      const totalOffset = spacing * (count - 1);
      const startOffset = -totalOffset / 2;
      
      group.forEach((segment, index) => {
        const offset = startOffset + spacing * index;
        const cable = cables.find(c => c.id === segment.cableId);
        if (!cable) return;
        
        const route = cable.route;
        const segIndex = segment.segmentIndex;
        
        if (isVertical) {
          route[segIndex].x += offset;
          route[segIndex + 1].x += offset;
        } else {
          route[segIndex].y += offset;
          route[segIndex + 1].y += offset;
        }
      });
    });
  }
  
  // Final validation to ensure all routes remain orthogonal after spacing
  cables.forEach(cable => {
    cable.route = ensureOrthogonalRoute(cable.route);
  });
  
  return cables;
};

// Main function to generate cable routes
const generateCableRoutes = (nodes, channels, connections) => {
  const nodeMap = nodes.reduce((map, node) => {
    map[node.id] = node;
    return map;
  }, {});
  
  // Gather edge connection information for spacing
  const edgeConnections = {};
  nodes.forEach(node => {
    edgeConnections[node.id] = { top: [], right: [], bottom: [], left: [] };
  });
  
  // Create initial cable objects with optimal edge choices
  const cables = connections.map((conn, idx) => {
    const sourceNode = nodeMap[conn.sourceNodeId];
    const targetNode = nodeMap[conn.targetNodeId];
    const { sourceEdge, targetEdge } = determineOptimalEdges(sourceNode, targetNode);
    edgeConnections[sourceNode.id][sourceEdge].push(conn.id);
    edgeConnections[targetNode.id][targetEdge].push(conn.id);
    return {
      id: conn.id,
      name: conn.name || `Cable ${idx + 1}`,
      sourceNodeId: conn.sourceNodeId,
      targetNodeId: conn.targetNodeId,
      forcedChannels: conn.forcedChannels || [],
      sourceEdge,
      targetEdge,
      route: []
    };
  });
  
  // Calculate connection points and generate routes
  cables.forEach(cable => {
    const sourceNode = nodeMap[cable.sourceNodeId];
    const targetNode = nodeMap[cable.targetNodeId];
    
    let forceCenter = false;
    if ((cable.sourceEdge === 'left' || cable.sourceEdge === 'right') &&
        (cable.targetEdge === 'left' || cable.targetEdge === 'right') &&
        Math.abs(sourceNode.y - targetNode.y) < HORIZONTAL_ALIGNMENT_THRESHOLD) {
      forceCenter = true;
    }
    const sourceConnIndex = edgeConnections[sourceNode.id][cable.sourceEdge].indexOf(cable.id);
    const sourceConnCount = edgeConnections[sourceNode.id][cable.sourceEdge].length;
    const targetConnIndex = edgeConnections[targetNode.id][cable.targetEdge].indexOf(cable.id);
    const targetConnCount = edgeConnections[targetNode.id][cable.targetEdge].length;
    const sourcePoint = calculateConnectionPoint(sourceNode, cable.sourceEdge, sourceConnIndex, sourceConnCount, forceCenter);
    const targetPoint = calculateConnectionPoint(targetNode, cable.targetEdge, targetConnIndex, targetConnCount, forceCenter);
    
    let route = [];
    if (cable.forcedChannels && cable.forcedChannels.length > 0) {
      route = applyForcedChannels(sourcePoint, targetPoint, cable.forcedChannels, channels);
    } else {
      route = generateOrthogonalRoute(sourceNode, targetNode, sourcePoint, targetPoint, cable.sourceEdge, cable.targetEdge);
      route = avoidObstacles(route, nodes, cable.sourceNodeId, cable.targetNodeId);
      route = useChannelsForRoute(route, channels);
    }
    
    // Apply fixes - ensure orthogonality and preserve connection points
    route = ensureOrthogonalRoute(route);
    route = preserveConnectionPoints(route, sourcePoint, targetPoint);
    
    cable.route = route;
  });
  
  return applySpacingToCables(cables, channels);
};

// =======================
// Component Implementations
// =======================
const Node = ({ node }) => (
  <g>
    <rect
      className="node-rect"
      x={node.x - node.width / 2}
      y={node.y - node.height / 2}
      width={node.width}
      height={node.height}
      rx={4}
      ry={4}
    />
    <text
      className="node-text"
      x={node.x}
      y={node.y}
      dominantBaseline="middle"
      textAnchor="middle"
    >
      {node.name}
    </text>
  </g>
);

const Channel = ({ channel }) => {
  if (channel.orientation === 'horizontal') {
    return (
      <line
        className="channel"
        x1={channel.start}
        y1={channel.position}
        x2={channel.end}
        y2={channel.position}
      />
    );
  } else {
    return (
      <line
        className="channel"
        x1={channel.position}
        y1={channel.start}
        x2={channel.position}
        y2={channel.end}
      />
    );
  }
};

const Cable = ({ cable, color, onMouseOver, onMouseOut }) => {
  const { route } = cable;
  if (!route || route.length < 2) return null;
  
  // Validate and ensure orthogonality
  const validatedRoute = ensureOrthogonalRoute(route);
  
  // Generate path data for orthogonal segments only
  const pathData = validatedRoute.reduce((acc, point, idx) => {
    if (idx === 0) return `M ${point.x} ${point.y}`;
    
    const prev = validatedRoute[idx - 1];
    // Verify segment is orthogonal
    if (prev.x === point.x || prev.y === point.y) {
      return `${acc} L ${point.x} ${point.y}`;
    }
    
    // Fallback for any non-orthogonal segments
    if (Math.abs(point.x - prev.x) >= Math.abs(point.y - prev.y)) {
      // Horizontal first
      return `${acc} L ${point.x} ${prev.y} L ${point.x} ${point.y}`;
    } else {
      // Vertical first
      return `${acc} L ${prev.x} ${point.y} L ${point.x} ${point.y}`;
    }
  }, '');
  
  return (
    <g 
      onMouseOver={onMouseOver} 
      onMouseOut={onMouseOut}
      className="cable-path"
    >
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={validatedRoute[0].x} cy={validatedRoute[0].y} r={3} fill={color} />
      <circle cx={validatedRoute[validatedRoute.length - 1].x} cy={validatedRoute[validatedRoute.length - 1].y} r={3} fill={color} />
    </g>
  );
};

// =======================
// Main Visualization Component
// =======================
const CableVisualization = ({ dimensions, mode, highlightedCable, setHighlightedCable, nodes, channels, cables }) => {
  const [draggedNode, setDraggedNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const handleMouseDown = useCallback((e, node) => {
    if (mode !== 'move') return;
    const svgRect = e.currentTarget.closest('svg').getBoundingClientRect();
    const x = e.clientX - svgRect.left;
    const y = e.clientY - svgRect.top;
    setDraggedNode(node.id);
    setDragOffset({ x: node.x - x, y: node.y - y });
  }, [mode]);
  
  const handleMouseMove = useCallback((e) => {
    if (!draggedNode || mode !== 'move') return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svgRect.left + dragOffset.x;
    const y = e.clientY - svgRect.top + dragOffset.y;
    nodes.forEach((node, idx) => {
      if (node.id === draggedNode) {
        nodes[idx].x = x;
        nodes[idx].y = y;
      }
    });
  }, [draggedNode, dragOffset, mode, nodes]);
  
  const handleMouseUp = useCallback(() => {
    setDraggedNode(null);
  }, []);
  
  return (
    <div className="cable-visualization">
      <svg
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {channels.map(ch => <Channel key={ch.id} channel={ch} />)}
        {cables.map((cable, idx) => (
          <Cable
            key={cable.id}
            cable={cable}
            color={getCableColor(idx, highlightedCable === cable.id)}
            onMouseOver={() => setHighlightedCable(cable.id)}
            onMouseOut={() => setHighlightedCable(null)}
          />
        ))}
        {nodes.map(node => (
          <g key={node.id} onMouseDown={(e) => handleMouseDown(e, node)}>
            <Node node={node} />
          </g>
        ))}
      </svg>
    </div>
  );
};

const getCableColor = (index, isHighlighted) => {
  const colors = [
    '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#d35400', '#34495e', '#16a085', '#c0392b',
    '#27ae60', '#e67e22', '#8e44ad', '#2980b9', '#f1c40f'
  ];
  const color = colors[index % colors.length];
  return isHighlighted ? color : `${color}80`;
};

// =======================
// Main App Component
// =======================
function App() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [mode, setMode] = useState('view'); // "view" or "move"
  const [highlightedCable, setHighlightedCable] = useState(null);
  
  // Larger and more spaced-out nodes
  const [nodes, setNodes] = useState([
    NodeModel('nodeA', 'A', 250, 100),    // Top node
    NodeModel('nodeB', 'B', 120, 400),    // Bottom left
    NodeModel('nodeC', 'C', 550, 400),    // Bottom right
    NodeModel('nodeD', 'D', 350, 400)     // In between bottom nodes
  ]);
  
  // Two channels: one vertical (to the left) and one horizontal (above)
  const [channels] = useState([
    ChannelModel('channelV', 'vertical', 50, 50, 550),
    ChannelModel('channelH', 'horizontal', 50, 50, 750)
  ]);
  
  // Define all cable connections
  const [cables, setCables] = useState([]);
  
  // 25 original cables plus 4 extra cables using channels:
  // Extra: one using a single channel and three using both channels.
  const connections = [
    // A-B (5 cables; one forced via horizontal channel)
    { id: 'cable1', name: 'Main Power', sourceNodeId: 'nodeA', targetNodeId: 'nodeB', forcedChannels: ['channelH'] },
    { id: 'cable2', name: 'Data Link', sourceNodeId: 'nodeA', targetNodeId: 'nodeB' },
    { id: 'cable3', name: 'Control Bus', sourceNodeId: 'nodeA', targetNodeId: 'nodeB' },
    { id: 'cable4', name: 'Aux Power', sourceNodeId: 'nodeA', targetNodeId: 'nodeB' },
    { id: 'cable5', name: 'Sensor Feed', sourceNodeId: 'nodeA', targetNodeId: 'nodeB' },
    
    // A-C (5 cables; one forced via vertical channel)
    { id: 'cable6', name: 'Status Signal', sourceNodeId: 'nodeA', targetNodeId: 'nodeC', forcedChannels: ['channelV'] },
    { id: 'cable7', name: 'Emergency Line', sourceNodeId: 'nodeA', targetNodeId: 'nodeC' },
    { id: 'cable8', name: 'Backup Link', sourceNodeId: 'nodeA', targetNodeId: 'nodeC' },
    { id: 'cable9', name: 'Monitor Feed', sourceNodeId: 'nodeA', targetNodeId: 'nodeC' },
    { id: 'cable10', name: 'Reset Line', sourceNodeId: 'nodeA', targetNodeId: 'nodeC' },
    
    // A-D (5 cables; one forced via both channels)
    { id: 'cable11', name: 'A-D Link 1', sourceNodeId: 'nodeA', targetNodeId: 'nodeD', forcedChannels: ['channelH', 'channelV'] },
    { id: 'cable12', name: 'A-D Link 2', sourceNodeId: 'nodeA', targetNodeId: 'nodeD' },
    { id: 'cable13', name: 'A-D Link 3', sourceNodeId: 'nodeA', targetNodeId: 'nodeD' },
    { id: 'cable14', name: 'A-D Link 4', sourceNodeId: 'nodeA', targetNodeId: 'nodeD' },
    { id: 'cable15', name: 'A-D Link 5', sourceNodeId: 'nodeA', targetNodeId: 'nodeD' },
    
    // B-C (5 cables; endpoints centered since nodes are horizontally aligned)
    { id: 'cable16', name: 'B-C Link 1', sourceNodeId: 'nodeB', targetNodeId: 'nodeC' },
    { id: 'cable17', name: 'B-C Link 2', sourceNodeId: 'nodeB', targetNodeId: 'nodeC' },
    { id: 'cable18', name: 'B-C Link 3', sourceNodeId: 'nodeB', targetNodeId: 'nodeC' },
    { id: 'cable19', name: 'B-C Link 4', sourceNodeId: 'nodeB', targetNodeId: 'nodeC' },
    { id: 'cable20', name: 'B-C Link 5', sourceNodeId: 'nodeB', targetNodeId: 'nodeC' },
    
    // B-D (3 cables)
    { id: 'cable21', name: 'B-D Link 1', sourceNodeId: 'nodeB', targetNodeId: 'nodeD' },
    { id: 'cable22', name: 'B-D Link 2', sourceNodeId: 'nodeB', targetNodeId: 'nodeD' },
    { id: 'cable23', name: 'B-D Link 3', sourceNodeId: 'nodeB', targetNodeId: 'nodeD' },
    
    // C-D (2 cables)
    { id: 'cable24', name: 'C-D Link 1', sourceNodeId: 'nodeC', targetNodeId: 'nodeD' },
    { id: 'cable25', name: 'C-D Link 2', sourceNodeId: 'nodeC', targetNodeId: 'nodeD' },
    
    // Extra cables using channels:
    // 1 cable forced to use 1 channel (horizontal)
    { id: 'cable26', name: 'Extra Cable 1', sourceNodeId: 'nodeB', targetNodeId: 'nodeA', forcedChannels: ['channelH'] },
    // 3 cables forced to use both channels
    { id: 'cable27', name: 'Extra Cable 2', sourceNodeId: 'nodeC', targetNodeId: 'nodeA', forcedChannels: ['channelH', 'channelV'] },
    { id: 'cable28', name: 'Extra Cable 3', sourceNodeId: 'nodeB', targetNodeId: 'nodeD', forcedChannels: ['channelH', 'channelV'] },
    { id: 'cable29', name: 'Extra Cable 4', sourceNodeId: 'nodeC', targetNodeId: 'nodeD', forcedChannels: ['channelH', 'channelV'] }
  ];
  
  useEffect(() => {
    const routedCables = generateCableRoutes(nodes, channels, connections);
    setCables(routedCables);
  }, [nodes, channels, connections]);
  
  // Responsive canvas dimensions with debouncing
  useEffect(() => {
    const handleResize = () => {
      const w = Math.max(800, Math.min(window.innerWidth - 40, 1200));
      const h = Math.max(600, Math.min(window.innerHeight - 200, 800));
      setDimensions({ width: w, height: h });
    };
    
    // Initialize dimensions
    handleResize();
    
    // Add debounced resize listener
    let resizeTimer;
    const debouncedResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 100);
    };
    
    window.addEventListener('resize', debouncedResize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedResize);
    };
  }, []);
  
  // Handle cable information display
  const [selectedCable, setSelectedCable] = useState(null);
  const selectedCableInfo = selectedCable ? cables.find(c => c.id === selectedCable) : null;
  
  const handleCableSelect = useCallback((cableId) => {
    setHighlightedCable(cableId);
    setSelectedCable(cableId);
  }, [setHighlightedCable]);
  
  const handleCableDeselect = useCallback(() => {
    setHighlightedCable(null);
    setSelectedCable(null);
  }, [setHighlightedCable]);
  
  return (
    <div className="app">
      <h1>Cable Routing Visualization</h1>
      
      <div className="controls">
        <button
          className={`control-btn ${mode === 'view' ? 'active' : ''}`}
          onClick={() => setMode('view')}
        >
          View Mode
        </button>
        <button
          className={`control-btn ${mode === 'move' ? 'active' : ''}`}
          onClick={() => setMode('move')}
        >
          Move Nodes
        </button>
        <button
          className="control-btn"
          onClick={() => {
            const w = Math.max(800, window.innerWidth - 40);
            const h = Math.max(600, window.innerHeight - 200);
            setDimensions({ width: w, height: h });
          }}
        >
          Optimize Size
        </button>
      </div>
      
      <div className="visualization-container">
        <CableVisualization
          dimensions={dimensions}
          mode={mode}
          highlightedCable={highlightedCable}
          setHighlightedCable={handleCableSelect}
          nodes={nodes}
          channels={channels}
          cables={cables}
        />
        
        {selectedCableInfo && (
          <div className="cable-info">
            <h3>Cable Information</h3>
            <p><strong>Name:</strong> {selectedCableInfo.name}</p>
            <p><strong>Source:</strong> Node {selectedCableInfo.sourceNodeId.replace('node', '')}</p>
            <p><strong>Target:</strong> Node {selectedCableInfo.targetNodeId.replace('node', '')}</p>
            <p>
              <strong>Channels:</strong> 
              {selectedCableInfo.forcedChannels && selectedCableInfo.forcedChannels.length > 0 
                ? selectedCableInfo.forcedChannels.map(ch => ch.replace('channel', '')).join(', ') 
                : 'None'}
            </p>
            <button className="close-btn" onClick={handleCableDeselect}>Close</button>
          </div>
        )}
      </div>
      
      <div className="legend">
        <h3>Legend</h3>
        <div className="legend-item">
          <div className="legend-color" style={{backgroundColor: '#3498db'}}></div>
          <span>Standard Cable</span>
        </div>
        <div className="legend-item">
          <div className="legend-color channel-legend"></div>
          <span>Channel</span>
        </div>
        <div className="legend-item">
          <div className="legend-color node-legend"></div>
          <span>Node</span>
        </div>
      </div>
      
      <style jsx>{`
        .app {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        
        h1 {
          text-align: center;
          color: #2c3e50;
          margin-bottom: 20px;
        }
        
        .controls {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .control-btn {
          padding: 8px 16px;
          background-color: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s ease;
          outline: none;
        }
        
        .control-btn:hover {
          background-color: #e9ecef;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        
        .control-btn.active {
          background-color: #4b6bfb;
          color: white;
          border-color: #4b6bfb;
        }
        
        .visualization-container {
          position: relative;
          margin-bottom: 20px;
        }
        
        .cable-visualization {
          border: 1px solid #dee2e6;
          border-radius: 8px;
          background-color: #f8f9fa;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
          overflow: hidden;
        }
        
        .cable-info {
          position: absolute;
          top: 10px;
          right: 10px;
          background-color: white;
          border-radius: 8px;
          padding: 15px;
          width: 250px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10;
        }
        
        .cable-info h3 {
          margin-top: 0;
          margin-bottom: 10px;
          color: #2c3e50;
        }
        
        .close-btn {
          padding: 6px 12px;
          background-color: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          margin-top: 10px;
          transition: all 0.2s ease;
        }
        
        .close-btn:hover {
          background-color: #e9ecef;
        }
        
        .legend {
          background-color: white;
          border-radius: 8px;
          padding: 15px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        .legend h3 {
          margin-top: 0;
          margin-bottom: 10px;
          color: #2c3e50;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
        }
        
        .legend-color {
          width: 20px;
          height: 10px;
          margin-right: 10px;
          border-radius: 3px;
        }
        
        .channel-legend {
          background-color: #dee2e6;
          height: 3px;
          position: relative;
        }
        
        .channel-legend::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-top: 2px dashed #adb5bd;
        }
        
        .node-legend {
          background-color: #ffffff;
          border: 2px solid #495057;
          height: 16px;
        }
        
        .node-rect {
          fill: #ffffff;
          stroke: #495057;
          stroke-width: 2;
          cursor: pointer;
          transition: fill 0.2s ease;
        }
        
        .node-rect:hover {
          fill: #f1f3f5;
        }
        
        .node-text {
          font-size: 14px;
          font-weight: bold;
          user-select: none;
          pointer-events: none;
        }
        
        .channel {
          stroke: #dee2e6;
          stroke-width: 3;
          stroke-dasharray: 5,3;
        }
        
        @media (max-width: 768px) {
          .controls {
            flex-wrap: wrap;
          }
          
          .cable-info {
            position: fixed;
            top: auto;
            right: auto;
            bottom: 10px;
            left: 10px;
            width: calc(100% - 40px);
          }
        }
      `}</style>
    </div>
  );
}

export default App;