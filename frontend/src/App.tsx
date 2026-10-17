import { useEffect, useState } from "react";
import { fetchDemoBoard, type DemoBoard } from "./api";
import BoardWorkspace from "./BoardWorkspace";

type BoardState =
  | { status: "pending" }
  | { status: "ready"; board: DemoBoard }
  | { status: "failed"; message: string };

export default function App() {
  const [state, setState] = useState<BoardState>({ status: "pending" });

  useEffect(() => {
    const controller = new AbortController();

    fetchDemoBoard(controller.signal).then(
      (board) => {
        if (!controller.signal.aborted) setState({ status: "ready", board });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "failed",
          message: error instanceof Error ? error.message : "Could not load the board.",
        });
      },
    );

    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="wordmark">zoomz<span className="wordmark-dot">.</span></span>
        <span className="header-label">Visual notebook</span>
      </header>
      {state.status === "ready" ? (
        <BoardWorkspace {...state.board} />
      ) : (
        <p className="fetch-status" role={state.status === "failed" ? "alert" : "status"}>
          {state.status === "pending" ? "Loading board…" : state.message}
        </p>
      )}
    </main>
  );
}
