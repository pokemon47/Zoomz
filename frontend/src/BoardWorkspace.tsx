import { Fragment, type CSSProperties } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { BoardNode, DemoBoard, ImageNode, NoteNode, Scene } from "./api";
import CameraControls from "./CameraControls";
import { Button } from "./components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./components/ui/breadcrumb";
import { useBoardNavigation } from "./useBoardNavigation";

type Node = Scene["nodes"][number];

function cardPosition(node: Node): CSSProperties {
  return { left: node.x, top: node.y, width: node.w, height: node.h };
}

function ImageCard({ node }: { node: ImageNode }) {
  return (
    <figure className="image-card" style={cardPosition(node)} data-node-id={node.id} data-node-type={node.type}>
      <div className="image-frame">
        <img src={node.content.src} alt={node.content.alt} draggable={false} />
      </div>
      <figcaption>{node.content.title}</figcaption>
    </figure>
  );
}

function NoteCard({ node }: { node: NoteNode }) {
  return (
    <article className="note-card" style={cardPosition(node)} data-node-id={node.id} data-node-type={node.type}>
      <span className="card-kicker">Note</span>
      <h2>{node.content.title}</h2>
      <p>{node.content.body}</p>
    </article>
  );
}

type ChildBoardCardProps = {
  node: BoardNode;
  scene: Scene;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onOpen: () => void;
};

function ChildBoardCard({ node, scene, selected, disabled, onSelect, onOpen }: ChildBoardCardProps) {
  const previews = scene.nodes.filter(
    (child): child is ImageNode => child.parentId === node.id && child.type === "image",
  ).slice(0, 4);

  return (
    <article
      className="child-board-card"
      style={cardPosition(node)}
      data-node-id={node.id}
      data-node-type={node.type}
      data-selected={selected}
      tabIndex={disabled ? -1 : 0}
      aria-label={`${node.content.title} board`}
      onClick={onSelect}
      onFocus={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen();
      }}
    >
      <div className="child-board-copy">
        <span className="card-kicker">Board</span>
        <h2>{node.content.title}</h2>
        {node.content.description && <p>{node.content.description}</p>}
      </div>
      <div className="preview-mosaic">
        {previews.map((image) => (
          <img key={image.id} src={image.content.src} alt={image.content.alt} draggable={false} />
        ))}
      </div>
      <Button
        className="open-board-action"
        type="button"
        size="sm"
        tabIndex={selected ? 0 : -1}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        Open board <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </article>
  );
}

export default function BoardWorkspace({ scene, rootBoard }: DemoBoard) {
  const navigation = useBoardNavigation({ scene, rootBoard });
  const { board } = navigation;

  return (
    <section className="board-workspace" onKeyDownCapture={navigation.onWorkspaceKeyDown}>
      <div className="board-heading">
        <div className="board-navigation">
          <Button variant="ghost" size="sm" type="button" onClick={navigation.back} disabled={!navigation.canGoBack || navigation.busy}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back
          </Button>
          <Breadcrumb aria-label="Board path">
            <BreadcrumbList>
              {navigation.crumbs.map((crumb, index) => (
                <Fragment key={crumb.id}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {crumb.id === board.id ? (
                      <BreadcrumbPage>{crumb.content.title}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<button type="button" disabled={navigation.busy} onClick={() => navigation.goToAncestor(crumb.id)} />}>
                        {crumb.content.title}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <h1>{board.content.title}</h1>
        <p className="board-description">{board.content.description ?? ""}</p>
      </div>
      <div
        ref={navigation.viewportRef}
        className="workspace-viewport"
        data-camera-viewport
        aria-busy={navigation.busy}
        role="region"
        tabIndex={0}
        aria-label={`${board.content.title} board, drag to pan; use Control or Command with the wheel to zoom`}
        onPointerDown={navigation.onPointerDown}
        onPointerMove={navigation.onPointerMove}
        onPointerUp={navigation.onPointerUp}
        onPointerCancel={navigation.onPointerCancel}
        onLostPointerCapture={navigation.onLostPointerCapture}
        onKeyDown={navigation.onKeyDown}
      >
        <motion.div
          key={board.id}
          className="board-surface"
          data-board-id={board.id}
          style={{ width: board.w, height: board.h, x: navigation.x, y: navigation.y, scale: navigation.scale, transformOrigin: "0 0" }}
        >
          {navigation.children.map((node) => {
            switch (node.type) {
              case "image":
                return <ImageCard key={node.id} node={node} />;
              case "note":
                return <NoteCard key={node.id} node={node} />;
              case "board":
                return (
                  <ChildBoardCard
                    key={node.id}
                    node={node}
                    scene={scene}
                    selected={navigation.selectedBoardId === node.id}
                    disabled={navigation.busy}
                    onSelect={() => navigation.selectBoard(node.id)}
                    onOpen={() => navigation.openBoard(node.id)}
                  />
                );
              default: {
                const _exhaustive: never = node;
                return _exhaustive;
              }
            }
          })}
        </motion.div>
        <CameraControls scale={navigation.scale} zoomIn={navigation.zoomIn} zoomOut={navigation.zoomOut} fit={navigation.fit} disabled={navigation.busy} />
      </div>
    </section>
  );
}
