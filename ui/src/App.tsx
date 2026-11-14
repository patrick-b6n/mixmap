import { useEffect, useState } from "react";
import { api } from "./api";

export default function App() {
  const [msg, setMsg] = useState("…");
  useEffect(() => {
    let live = true;
    api.hello().then(
      (h) => live && setMsg(`${h.message} (v${h.version})`),
      (e) => live && setMsg(String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  return <main style={{ padding: 16 }}>{msg}</main>;
}
