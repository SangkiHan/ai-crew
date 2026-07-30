import { useEffect } from "react";
import type { ServerToUiEvent } from "@ai-crew/shared";
import { useStore } from "../store.js";

const RECONNECT_DELAY_MS = 2000;

export function useUiSocket() {
  useEffect(() => {
    let ws: WebSocket;
    let cancelled = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${location.host}/ws/ui`);

      ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as ServerToUiEvent;
          useStore.getState().handleServerEvent(event);
        } catch {
          // 파싱 실패한 메시지는 무시
        }
      };

      ws.onclose = () => {
        if (!cancelled) setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);
}
