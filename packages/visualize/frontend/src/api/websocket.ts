/** WebSocket client with auto-reconnect. */

import type { WSMessage } from './types';

export type MessageHandler = (msg: WSMessage) => void;
export type StatusHandler = (status: 'connected' | 'disconnected' | 'loading') => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage: MessageHandler;
  private onStatus: StatusHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onMessage: MessageHandler, onStatus: StatusHandler) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${location.host}/ws`;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.onStatus('connected');
      this.send({ type: 'model_info' });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage;
        this.onMessage(msg);
      } catch {
        console.error('Failed to parse WS message', e.data);
      }
    };

    this.ws.onclose = () => {
      this.onStatus('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
