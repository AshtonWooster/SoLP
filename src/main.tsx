import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./screens/Home.tsx";
import { Board } from "./screens/Board.tsx";
import { Gm } from "./screens/Gm.tsx";
import { Play } from "./screens/Play.tsx";
import "./styles.css";

const screens: Record<string, ComponentType> = { "/board": Board, "/gm": Gm, "/play": Play };
const Screen = screens[location.pathname.replace(/\/$/, "")] ?? Home;

createRoot(document.getElementById("root")!).render(<Screen />);
