import { useWebSocket } from '@vueuse/core';

export type ChatMessage = {
  sender: { email: string; name: string };
  content: string;
  timestamp: string;
  decisionId?: string;
  verticalKey?: string;
};

export type WebSocketUser = {
  id: string;
  name: string;
};

export type WebSocketConfig = {
  decisionId: string;
  verticalKey: string;
  autoReconnect?: boolean;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
  onMessage?: (data: unknown) => void;
};

export function useWS(config: WebSocketConfig) {
  const messages = ref<ChatMessage[]>([]);
  const status = ref('DISCONNECTED');
  const isConnected = ref(false);
  const currentUser = ref();

  if (!config.decisionId || !config.verticalKey) {
    console.log('WebSocket not initialized - missing required values:', {
      decisionId: config.decisionId,
      verticalKey: config.verticalKey
    });
    return {
      messages: readonly(messages),
      sendChat: () => {},
      status: readonly(status),
      isConnected: readonly(isConnected),
      connect: () => {},
      disconnect: () => {},
      sendMessage: () => {}
    };
  }

  // console.log(
  //   'Initializing WebSocket with:',
  //   config.decisionId,
  //   config.verticalKey,
  //   config.currentUser
  // );

  let authToken = '';
  let wsInstance: unknown = null;

  async function connect() {
    try {
      // Get auth token and user info
      const response = await $fetch('/api/ws/validate', {
        method: 'POST',
        body: {
          decisionId: config.decisionId,
          verticalKey: config.verticalKey
        }
      });

      if (!response.success) throw new Error('Token fetch failed');
      currentUser.value = response.user;

      // Construct the first protocol as room:userId base64
      const roomUser = `${config.decisionId}:${currentUser.value.email}`;
      const protocol = btoa(roomUser).replace(/=/g, '');

      wsInstance = useWebSocket(response.websocketUrl, {
        protocols: [protocol], // first protocol must be room:userId
        autoReconnect: config.autoReconnect ?? true,
        onConnected: () => {
          console.log('WebSocket connected');
          isConnected.value = true;
          status.value = 'CONNECTED';

          // Send name immediately
          wsInstance.send(
            JSON.stringify({
              type: 'name',
              name:
                currentUser.value?.displayName ||
                currentUser.value?.firstName ||
                currentUser.value.email
            })
          );

          config.onConnected?.();
        },
        onDisconnected: () => {
          console.log('WebSocket disconnected');
          isConnected.value = false;
          status.value = 'DISCONNECTED';
        },
        onMessage: (_ws, event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'chat') {
              messages.value.push({
                sender: { email: data.userId, name: data.userName },
                content: data.text,
                timestamp: data.time,
                decisionId: config.decisionId,
                verticalKey: config.verticalKey
              });
            }
            config.onMessage?.(data);
          } catch (err) {
            console.error('Error parsing WS message:', err);
          }
        },
        onError: (error) => {
          console.error('WebSocket error:', error);
          status.value = 'ERROR';
          config.onError?.(error);
        }
      });

      await new Promise((r) => setTimeout(r, 300));
      wsInstance.open();
    } catch (error) {
      console.error('Failed to connect:', error);
      status.value = 'ERROR';
      config.onError?.(error);
    }
  }

  function sendChatMsg(content: string) {
    if (!isConnected.value || !wsInstance) return;

    wsInstance.send(
      JSON.stringify({
        type: 'chat',
        text: content
      })
    );
  }


  function sendMessage(type: string, payload: Record<string, unknown>) {
    if (!isConnected.value || !wsInstance) {
      console.warn('Cannot send message - WebSocket not connected');
      return;
    }

    wsInstance.send(
      JSON.stringify({
        type,
        ...payload
      })
    );
  }

  function disconnect() {
    if (wsInstance) {
      wsInstance.close();
      wsInstance = null;
    }
  }

  return {
    messages: readonly(messages),
    sendChat: sendChatMsg,
    sendMessage,
    status: readonly(status),
    isConnected: readonly(isConnected),
    connect,
    disconnect
  };
}
