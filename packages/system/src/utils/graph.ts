/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  boxToRect,
  clampPosition,
  getBoundsOfBoxes,
  getOverlappingArea,
  nodeToRect,
  pointToRendererPoint,
  getViewportForBounds,
  isCoordinateExtent,
  getNodeDimensions,
  nodeToBox,
} from './general';
import {
  type Transform,
  type XYPosition,
  type Rect,
  type NodeOrigin,
  type NodeBase,
  type EdgeBase,
  type FitViewParamsBase,
  type FitViewOptionsBase,
  CoordinateExtent,
  OnError,
  OnBeforeDeleteBase,
  NodeLookup,
  InternalNodeBase,
  NodeDragItem,
} from '../types';
import { errorMessages } from '../constants';

/**
 * Test whether an object is useable as an Edge
 * @public
 * @remarks In TypeScript this is a type guard that will narrow the type of whatever you pass in to Edge if it returns true
 * @param element - The element to test
 * @returns A boolean indicating whether the element is an Edge
 */
export const isEdgeBase = <EdgeType extends EdgeBase = EdgeBase>(element: any): element is EdgeType =>
  'id' in element && 'source' in element && 'target' in element;

/**
 * Test whether an object is useable as a Node
 * @public
 * @remarks In TypeScript this is a type guard that will narrow the type of whatever you pass in to Node if it returns true
 * @param element - The element to test
 * @returns A boolean indicating whether the element is an Node
 */
export const isNodeBase = <NodeType extends NodeBase = NodeBase>(element: any): element is NodeType =>
  'id' in element && 'position' in element && !('source' in element) && !('target' in element);

export const isInternalNodeBase = <NodeType extends InternalNodeBase = InternalNodeBase>(
  element: any
): element is NodeType => 'id' in element && 'internals' in element && !('source' in element) && !('target' in element);

/**
 * Pass in a node, and get connected nodes where edge.source === node.id
 * @public
 * @param node - The node to get the connected nodes from
 * @param nodes - The array of all nodes
 * @param edges - The array of all edges
 * @returns An array of nodes that are connected over eges where the source is the given node
 */
export const getOutgoers = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  node: NodeType | { id: string },
  nodes: NodeType[],
  edges: EdgeType[]
): NodeType[] => {
  if (!node.id) {
    return [];
  }

  const outgoerIds = new Set();
  edges.forEach((edge) => {
    if (edge.source === node.id) {
      outgoerIds.add(edge.target);
    }
  });

  return nodes.filter((n) => outgoerIds.has(n.id));
};

/**
 * Pass in a node, and get connected nodes where edge.target === node.id
 * @public
 * @param node - The node to get the connected nodes from
 * @param nodes - The array of all nodes
 * @param edges - The array of all edges
 * @returns An array of nodes that are connected over eges where the target is the given node
 */
export const getIncomers = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  node: NodeType | { id: string },
  nodes: NodeType[],
  edges: EdgeType[]
): NodeType[] => {
  if (!node.id) {
    return [];
  }
  const incomersIds = new Set();
  edges.forEach((edge) => {
    if (edge.target === node.id) {
      incomersIds.add(edge.source);
    }
  });

  return nodes.filter((n) => incomersIds.has(n.id));
};

export const getNodePositionWithOrigin = (
  node: InternalNodeBase | NodeBase,
  nodeOrigin: NodeOrigin = [0, 0]
): { position: XYPosition; positionAbsolute: XYPosition } => {
  const { width, height } = getNodeDimensions(node);
  const positionAbsolute = 'internals' in node ? node.internals.positionAbsolute : node.position;
  const origin = node.origin || nodeOrigin;
  const offsetX = width * origin[0];
  const offsetY = height * origin[1];

  return {
    position: {
      x: node.position.x - offsetX,
      y: node.position.y - offsetY,
    },
    positionAbsolute: {
      x: positionAbsolute.x - offsetX,
      y: positionAbsolute.y - offsetY,
    },
  };
};

export type GetNodesBoundsParams = {
  nodeOrigin?: NodeOrigin;
};

/**
 * Determines a bounding box that contains all given nodes in an array
 * @public
 * @remarks Useful when combined with {@link getViewportForBounds} to calculate the correct transform to fit the given nodes in a viewport.
 * @param nodes - Nodes to calculate the bounds for
 * @param params.nodeOrigin - Origin of the nodes: [0, 0] - top left, [0.5, 0.5] - center
 * @returns Bounding box enclosing all nodes
 */
export const getNodesBounds = (nodes: NodeBase[], params: GetNodesBoundsParams = { nodeOrigin: [0, 0] }): Rect => {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const box = nodes.reduce(
    (currBox, node) => {
      const nodeBox = nodeToBox(node, params.nodeOrigin);
      return getBoundsOfBoxes(currBox, nodeBox);
    },
    { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity }
  );

  return boxToRect(box);
};

export type GetInternalNodesBoundsParams<NodeType> = {
  nodeOrigin?: NodeOrigin;
  useRelativePosition?: boolean;
  filter?: (node: NodeType) => boolean;
};

/**
 * Determines a bounding box that contains all given nodes in an array
 * @internal
 */
export const getInternalNodesBounds = <NodeType extends InternalNodeBase | NodeDragItem>(
  nodeLookup: Map<string, NodeType>,
  params: GetInternalNodesBoundsParams<NodeType> = {
    nodeOrigin: [0, 0],
  }
): Rect => {
  if (nodeLookup.size === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let box = { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity };

  nodeLookup.forEach((node) => {
    if (params.filter == undefined || params.filter(node)) {
      const nodeBox = nodeToBox(node as InternalNodeBase, params.nodeOrigin);
      box = getBoundsOfBoxes(box, nodeBox);
    }
  });

  return boxToRect(box);
};

export const getNodesInside = <NodeType extends NodeBase = NodeBase>(
  nodes: Map<string, InternalNodeBase<NodeType>>,
  rect: Rect,
  [tx, ty, tScale]: Transform = [0, 0, 1],
  partially = false,
  // set excludeNonSelectableNodes if you want to pay attention to the nodes "selectable" attribute
  excludeNonSelectableNodes = false,
  nodeOrigin: NodeOrigin = [0, 0]
): InternalNodeBase<NodeType>[] => {
  const paneRect = {
    ...pointToRendererPoint(rect, [tx, ty, tScale]),
    width: rect.width / tScale,
    height: rect.height / tScale,
  };

  const visibleNodes: InternalNodeBase<NodeType>[] = [];

  for (const [, node] of nodes) {
    const { measured, selectable = true, hidden = false } = node;
    const width = measured.width ?? node.width ?? node.initialWidth ?? null;
    const height = measured.height ?? node.height ?? node.initialHeight ?? null;

    if ((excludeNonSelectableNodes && !selectable) || hidden) {
      continue;
    }

    const overlappingArea = getOverlappingArea(paneRect, nodeToRect(node, nodeOrigin));
    const notInitialized = width === null || height === null;

    const partiallyVisible = partially && overlappingArea > 0;
    const area = (width ?? 0) * (height ?? 0);
    const isVisible = notInitialized || partiallyVisible || overlappingArea >= area;

    if (isVisible || node.dragging) {
      visibleNodes.push(node);
    }
  }

  return visibleNodes;
};

/**
 * Get all connecting edges for a given set of nodes
 * @param nodes - Nodes you want to get the connected edges for
 * @param edges - All edges
 * @returns Array of edges that connect any of the given nodes with each other
 */
export const getConnectedEdges = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  nodes: NodeType[],
  edges: EdgeType[]
): EdgeType[] => {
  const nodeIds = new Set();
  nodes.forEach((node) => {
    nodeIds.add(node.id);
  });

  return edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
};

export function fitView<Params extends FitViewParamsBase<NodeBase>, Options extends FitViewOptionsBase<NodeBase>>(
  { nodeLookup, width, height, panZoom, minZoom, maxZoom, nodeOrigin = [0, 0] }: Params,
  options?: Options
) {
  const filteredNodes: InternalNodeBase[] = [];
  const optionNodeIds = options?.nodes ? new Set(options.nodes.map((node) => node.id)) : null;

  nodeLookup.forEach((n) => {
    const isVisible = n.measured.width && n.measured.height && (options?.includeHiddenNodes || !n.hidden);

    if (isVisible && (!optionNodeIds || optionNodeIds.has(n.id))) {
      filteredNodes.push(n);
    }
  });

  if (filteredNodes.length > 0) {
    const bounds = getNodesBounds(filteredNodes, { nodeOrigin });

    const viewport = getViewportForBounds(
      bounds,
      width,
      height,
      options?.minZoom ?? minZoom,
      options?.maxZoom ?? maxZoom,
      options?.padding ?? 0.1
    );

    panZoom.setViewport(viewport, { duration: options?.duration });

    return true;
  }

  return false;
}

/**
 * This function clamps the passed extend by the node's width and height.
 * This is needed to prevent the node from being dragged outside of its extent.
 *
 * @param node
 * @param extent
 * @returns
 */
function clampNodeExtent<NodeType extends NodeBase>(
  node: NodeType,
  extent?: CoordinateExtent | 'parent'
): CoordinateExtent | 'parent' | undefined {
  if (!extent || extent === 'parent') {
    return extent;
  }
  return [extent[0], [extent[1][0] - (node.measured?.width ?? 0), extent[1][1] - (node.measured?.height ?? 0)]];
}

/**
 * This function calculates the next position of a node, taking into account the node's extent, parent node, and origin.
 *
 * @internal
 * @returns position, positionAbsolute
 */
export function calculateNodePosition<NodeType extends NodeBase>({
  nodeId,
  nextPosition,
  nodeLookup,
  nodeOrigin = [0, 0],
  nodeExtent,
  onError,
}: {
  nodeId: string;
  nextPosition: XYPosition;
  nodeLookup: NodeLookup<InternalNodeBase<NodeType>>;
  nodeOrigin?: NodeOrigin;
  nodeExtent?: CoordinateExtent;
  onError?: OnError;
}): { position: XYPosition; positionAbsolute: XYPosition } {
  const node = nodeLookup.get(nodeId)!;
  const parentNode = node.parentId ? nodeLookup.get(node.parentId) : undefined;
  const { x: parentX, y: parentY } = parentNode
    ? getNodePositionWithOrigin(parentNode, parentNode.origin || nodeOrigin).positionAbsolute
    : { x: 0, y: 0 };

  let currentExtent = clampNodeExtent(node, node.extent || nodeExtent);

  if (node.extent === 'parent' && !node.expandParent) {
    if (!parentNode) {
      onError?.('005', errorMessages['error005']());
    } else {
      const nodeWidth = node.measured.width;
      const nodeHeight = node.measured.height;
      const parentWidth = parentNode.measured.width;
      const parentHeight = parentNode.measured.height;

      if (nodeWidth && nodeHeight && parentWidth && parentHeight) {
        const currNodeOrigin = node.origin || nodeOrigin;
        const extentX = parentX + nodeWidth * currNodeOrigin[0];
        const extentY = parentY + nodeHeight * currNodeOrigin[1];

        currentExtent = [
          [extentX, extentY],
          [extentX + parentWidth - nodeWidth, extentY + parentHeight - nodeHeight],
        ];
      }
    }
  } else if (parentNode && isCoordinateExtent(node.extent)) {
    currentExtent = [
      [node.extent[0][0] + parentX, node.extent[0][1] + parentY],
      [node.extent[1][0] + parentX, node.extent[1][1] + parentY],
    ];
  }

  const positionAbsolute = isCoordinateExtent(currentExtent)
    ? clampPosition(nextPosition, currentExtent)
    : nextPosition;

  return {
    position: {
      x: positionAbsolute.x - parentX,
      y: positionAbsolute.y - parentY,
    },
    positionAbsolute,
  };
}

/**
 * Pass in nodes & edges to delete, get arrays of nodes and edges that actually can be deleted
 * @internal
 * @param param.nodesToRemove - The nodes to remove
 * @param param.edgesToRemove - The edges to remove
 * @param param.nodes - All nodes
 * @param param.edges - All edges
 * @param param.onBeforeDelete - Callback to check which nodes and edges can be deleted
 * @returns nodes: nodes that can be deleted, edges: edges that can be deleted
 */
export async function getElementsToRemove<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>({
  nodesToRemove = [],
  edgesToRemove = [],
  nodes,
  edges,
  onBeforeDelete,
}: {
  nodesToRemove: Partial<NodeType>[];
  edgesToRemove: Partial<EdgeType>[];
  nodes: NodeType[];
  edges: EdgeType[];
  onBeforeDelete?: OnBeforeDeleteBase<NodeType, EdgeType>;
}): Promise<{
  nodes: NodeType[];
  edges: EdgeType[];
}> {
  const nodeIds = new Set(nodesToRemove.map((node) => node.id));
  const matchingNodes: NodeType[] = [];

  for (const node of nodes) {
    if (node.deletable === false) {
      continue;
    }

    const isIncluded = nodeIds.has(node.id);
    const parentHit = !isIncluded && node.parentId && matchingNodes.find((n) => n.id === node.parentId);

    if (isIncluded || parentHit) {
      matchingNodes.push(node);
    }
  }

  const edgeIds = new Set(edgesToRemove.map((edge) => edge.id));
  const deletableEdges = edges.filter((edge) => edge.deletable !== false);
  const connectedEdges = getConnectedEdges(matchingNodes, deletableEdges);
  const matchingEdges: EdgeType[] = connectedEdges;

  for (const edge of deletableEdges) {
    const isIncluded = edgeIds.has(edge.id);

    if (isIncluded && !matchingEdges.find((e) => e.id === edge.id)) {
      matchingEdges.push(edge);
    }
  }

  if (!onBeforeDelete) {
    return {
      edges: matchingEdges,
      nodes: matchingNodes,
    };
  }

  const onBeforeDeleteResult = await onBeforeDelete({
    nodes: matchingNodes,
    edges: matchingEdges,
  });

  if (typeof onBeforeDeleteResult === 'boolean') {
    return onBeforeDeleteResult ? { edges: matchingEdges, nodes: matchingNodes } : { edges: [], nodes: [] };
  }

  return onBeforeDeleteResult;
}