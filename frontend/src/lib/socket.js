import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      withCredentials: true,
      autoConnect: true,
      transports: ['websocket', 'polling']
    });
  }
  return socket;
}

export default getSocket;
