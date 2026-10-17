import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { animate, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import type { BoardNode, DemoBoard } from "./api";
import {
  BUTTON_ZOOM_STEP,
  KEYBOARD_PAN_PIXELS,
  WHEEL_ZOOM_SENSITIVITY,
  boardBounds,
  bookmarkCamera,
  cardBounds,
  clientPoint,
  fitCamera,
  intoChild,
  intoParent,
  restoreCamera,
  wheelPixels,
  zoomAt,
  type Camera,
  type CameraBookmark,
  type Point,
  type Viewport,
} from "./cameraMath";

type BoardEdge = { child: BoardNode; returnView: CameraBookmark };
type NavigationPhase =
  | { kind: "idle" }
  | { kind: "enter"; step: "card"; edge: BoardEdge }
  | { kind: "enter"; step: "contents" }
  | { kind: "leave"; step: "card"; edge: BoardEdge; targetDepth: number }
  | { kind: "leave"; step: "restore"; returnView: CameraBookmark };
type Navigation = { path: BoardEdge[]; phase: NavigationPhase; selectedBoardId: BoardNode["id"] | null };
type Drag = { pointerId: number; client: Point };

const CAMERA_SPRING = { type: "spring", stiffness: 180, damping: 27, mass: 1, restDelta: 0.001, restSpeed: 0.01 } satisfies Parameters<typeof animate<number>>[2];
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useBoardNavigation({ scene, rootBoard }: DemoBoard) {
  const [navigation, setNavigation] = useState<Navigation>({ path: [], phase: { kind: "idle" }, selectedBoardId: null });
  const navigationRef = useRef(navigation);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const initialFitDone = useRef(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const board = navigation.path.at(-1)?.child ?? rootBoard;
  const children = scene.nodes.filter((node) => node.parentId === board.id);
  const busy = navigation.phase.kind !== "idle";

  const updateNavigation = useCallback((next: Navigation) => {
    navigationRef.current = next;
    setNavigation(next);
  }, []);

  const readCamera = useCallback((): Camera => ({ x: x.get(), y: y.get(), scale: scale.get() }), [x, y, scale]);
  const writeCamera = useCallback((camera: Camera) => {
    x.set(camera.x);
    y.set(camera.y);
    scale.set(camera.scale);
  }, [x, y, scale]);

  const viewportSize = useCallback((): Viewport | null => {
    const element = viewportRef.current;
    if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) return null;
    return { width: element.clientWidth, height: element.clientHeight };
  }, []);

  const releaseDrag = useCallback(() => {
    const drag = dragRef.current;
    const element = viewportRef.current;
    dragRef.current = null;
    if (!element) return;
    delete element.dataset.dragging;
    if (drag && element.hasPointerCapture(drag.pointerId)) element.releasePointerCapture(drag.pointerId);
  }, []);

  const fit = useCallback(() => {
    const current = navigationRef.current;
    const size = viewportSize();
    if (!size || current.phase.kind !== "idle") return;
    const currentBoard = current.path.at(-1)?.child ?? rootBoard;
    writeCamera(fitCamera(boardBounds(currentBoard, scene.nodes.filter((node) => node.parentId === currentBoard.id)), size));
  }, [rootBoard, scene, viewportSize, writeCamera]);

  const zoom = useCallback((factor: number) => {
    const size = viewportSize();
    if (!size || navigationRef.current.phase.kind !== "idle") return;
    const current = readCamera();
    writeCamera(zoomAt(current, current.scale * factor, { x: size.width / 2, y: size.height / 2 }));
  }, [readCamera, viewportSize, writeCamera]);

  const pan = useCallback((delta: Point) => {
    if (navigationRef.current.phase.kind !== "idle") return;
    x.set(x.get() + delta.x);
    y.set(y.get() + delta.y);
  }, [x, y]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      if (initialFitDone.current || !viewportSize()) return;
      fit();
      initialFitDone.current = true;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      releaseDrag();
    };
  }, [fit, releaseDrag, viewportSize]);

  useEffect(() => {
    const phase = navigation.phase;
    const element = viewportRef.current;
    if (phase.kind === "idle" || !element) return;
    let active = true;
    let attempt = 0;
    let animation: AnimationPlaybackControls | undefined;
    let measuredSize: Viewport | null = null;

    const commitPhaseAtCamera = (target: Camera) => {
      let next: Navigation;
      let camera = target;
      if (phase.kind === "enter" && phase.step === "card") {
        camera = intoChild(target, phase.edge.child);
        next = { path: [...navigation.path, phase.edge], phase: { kind: "enter", step: "contents" }, selectedBoardId: null };
      } else if (phase.kind === "leave" && phase.step === "card") {
        camera = intoParent(target, phase.edge.child);
        const path = navigation.path.slice(0, -1);
        const edge = path.at(-1);
        next = {
          path,
          selectedBoardId: phase.edge.child.id,
          phase: path.length > phase.targetDepth && edge
            ? { kind: "leave", step: "card", edge, targetDepth: phase.targetDepth }
            : { kind: "leave", step: "restore", returnView: phase.edge.returnView },
        };
      } else {
        next = { ...navigation, phase: { kind: "idle" } };
      }

      flushSync(() => {
        writeCamera(camera);
        updateNavigation(next);
      });
      if (next.phase.kind === "idle") element.focus({ preventScroll: true });
    };

    const retarget = () => {
      const run = ++attempt;
      animation?.stop();
      measuredSize = viewportSize();
      if (!measuredSize) return;
      const target = phase.kind === "enter"
        ? phase.step === "card"
          ? fitCamera(cardBounds(phase.edge.child), measuredSize)
          : fitCamera(boardBounds(board, scene.nodes.filter((node) => node.parentId === board.id)), measuredSize)
        : phase.step === "card"
          ? intoChild(fitCamera(cardBounds(phase.edge.child), measuredSize), phase.edge.child)
          : restoreCamera(phase.returnView, measuredSize);
      const finish = () => {
        if (active && attempt === run) commitPhaseAtCamera(target);
      };
      if (reducedMotion) {
        queueMicrotask(finish);
        return;
      }
      const start = readCamera();
      animation = animate(0, 1, {
        ...CAMERA_SPRING,
        onUpdate: (progress) => {
          if (!active || attempt !== run) return;
          writeCamera({
            x: start.x + (target.x - start.x) * progress,
            y: start.y + (target.y - start.y) * progress,
            scale: start.scale + (target.scale - start.scale) * progress,
          });
        },
        onComplete: finish,
      });
    };

    retarget();
    const observer = new ResizeObserver(() => {
      const size = viewportSize();
      if (size?.width !== measuredSize?.width || size?.height !== measuredSize?.height) retarget();
    });
    observer.observe(element);
    return () => {
      active = false;
      animation?.stop();
      observer.disconnect();
    };
  }, [board, navigation, readCamera, reducedMotion, scene, updateNavigation, viewportSize, writeCamera]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (navigationRef.current.phase.kind !== "idle") return;
      if (event.target instanceof Element && event.target.closest("[data-camera-controls]")) return;
      const size = viewportSize();
      if (!size) return;
      const delta = wheelPixels({ x: event.deltaX, y: event.deltaY }, event.deltaMode, size);
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const anchor = clientPoint(
          { x: event.clientX, y: event.clientY },
          { left: rect.left, top: rect.top, clientLeft: element.clientLeft, clientTop: element.clientTop },
        );
        const current = readCamera();
        writeCamera(zoomAt(current, current.scale * Math.exp(-delta.y * WHEEL_ZOOM_SENSITIVITY), anchor));
      } else {
        pan({ x: -delta.x, y: -delta.y });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [pan, readCamera, viewportSize, writeCamera]);

  const selectBoard = (id: BoardNode["id"]) => {
    const current = navigationRef.current;
    if (current.phase.kind !== "idle" || current.selectedBoardId === id) return;
    updateNavigation({ ...current, selectedBoardId: id });
  };

  const openBoard = (id: BoardNode["id"]) => {
    const current = navigationRef.current;
    const size = viewportSize();
    if (current.phase.kind !== "idle" || !size) return;
    const parent = current.path.at(-1)?.child ?? rootBoard;
    const child = scene.nodes.find((node): node is BoardNode => node.type === "board" && node.id === id && node.parentId === parent.id);
    if (!child) return;
    releaseDrag();
    const edge = { child, returnView: bookmarkCamera(readCamera(), size) };
    updateNavigation({ ...current, selectedBoardId: id, phase: { kind: "enter", step: "card", edge } });
  };

  const goToDepth = (targetDepth: number) => {
    const current = navigationRef.current;
    const edge = current.path.at(-1);
    if (current.phase.kind !== "idle" || !edge || targetDepth < 0 || targetDepth >= current.path.length) return;
    releaseDrag();
    updateNavigation({ ...current, phase: { kind: "leave", step: "card", edge, targetDepth } });
  };

  const back = () => goToDepth(navigationRef.current.path.length - 1);
  const goToAncestor = (id: BoardNode["id"]) => {
    if (id === rootBoard.id) goToDepth(0);
    else {
      const index = navigationRef.current.path.findIndex((edge) => edge.child.id === id);
      if (index >= 0) goToDepth(index + 1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (navigationRef.current.phase.kind !== "idle" || dragRef.current || !event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("[data-node-id], [data-camera-controls]")) return;
    const element = event.currentTarget;
    dragRef.current = { pointerId: event.pointerId, client: { x: event.clientX, y: event.clientY } };
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    element.dataset.dragging = "true";
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pan({ x: event.clientX - drag.client.x, y: event.clientY - drag.client.y });
    drag.client = { x: event.clientX, y: event.clientY };
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) releaseDrag();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case "ArrowLeft": pan({ x: KEYBOARD_PAN_PIXELS, y: 0 }); break;
      case "ArrowRight": pan({ x: -KEYBOARD_PAN_PIXELS, y: 0 }); break;
      case "ArrowUp": pan({ x: 0, y: KEYBOARD_PAN_PIXELS }); break;
      case "ArrowDown": pan({ x: 0, y: -KEYBOARD_PAN_PIXELS }); break;
      case "+":
      case "=": zoom(BUTTON_ZOOM_STEP); break;
      case "-":
      case "_": zoom(1 / BUTTON_ZOOM_STEP); break;
      case "0": fit(); break;
      default: return;
    }
    event.preventDefault();
  };

  const onWorkspaceKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    back();
  };

  return {
    board,
    children,
    crumbs: [rootBoard, ...navigation.path.map((edge) => edge.child)],
    selectedBoardId: navigation.selectedBoardId,
    busy,
    canGoBack: navigation.path.length > 0,
    selectBoard,
    openBoard,
    back,
    goToAncestor,
    onWorkspaceKeyDown,
    viewportRef,
    x,
    y,
    scale,
    fit,
    zoomIn: () => zoom(BUTTON_ZOOM_STEP),
    zoomOut: () => zoom(1 / BUTTON_ZOOM_STEP),
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onKeyDown,
  };
}
