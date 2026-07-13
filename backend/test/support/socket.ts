import { io, Socket } from 'socket.io-client';

export function connectSocket(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], forceNew: true });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

export function joinScreening(
  socket: Socket,
  screeningId: number,
): Promise<{ ok: boolean; seats?: unknown[]; summary?: unknown; error?: string }> {
  return new Promise((resolve) => {
    socket.emit('join:screening', { screeningId }, resolve);
  });
}

export function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
