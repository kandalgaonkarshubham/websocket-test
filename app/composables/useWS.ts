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
  const currentUser = ref<User>();

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
      // Get auth token
      const response = await $fetch('/api/ws/validate', {
        method: 'POST',
        body: {
          decisionId: config.decisionId,
          verticalKey: config.verticalKey
        }
      });

      if (!response.success) throw new Error('Token fetch failed');
      authToken = response.token;
      currentUser.value = response.user;

      // Create protocol
      const connectionData = `${config.decisionId}:${config.verticalKey}:${currentUser.value.email}:${authToken}`;
      const protocol = btoa(connectionData);

      // connect to Durable Object directly
      wsInstance = useWebSocket(response.websocketUrl, {
        protocols: [protocol.replaceAll('=', ''), 'chat'],
        autoReconnect: config.autoReconnect ?? true,
        onConnected: () => {
          console.log('WebSocket connected');
          isConnected.value = true;
          status.value = 'CONNECTED';

          // Send user name
          wsInstance.send(
            JSON.stringify({
              type: 'name',
              name:
                currentUser.value?.displayName ||
                currentUser.value?.firstName ||
                currentUser.value.email
            })
          );

          if (config.onConnected) {
            config.onConnected();
          }
        },
        onDisconnected: () => {
          console.log('WebSocket disconnected');
          isConnected.value = false;
          status.value = 'DISCONNECTED';
        },
        onMessage: (_ws: unknown, event: unknown) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'chat') {
              messages.value.push({
                sender: { email: data.userEmail, name: data.userName },
                content: data.text,
                timestamp: data.time,
                decisionId: data.decisionId,
                verticalKey: data.verticalKey
              });
            }

            if (config.onMessage) {
              config.onMessage(data);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        },
        onError: (error: unknown) => {
          console.error('WebSocket error:', error);
          status.value = 'ERROR';
          if (config.onError) {
            config.onError(error);
          }
        }
      });

      await new Promise((r) => setTimeout(r, 500));
      wsInstance.open();
    } catch (error) {
      console.error('Failed to connect:', error);
      status.value = 'ERROR';
      if (config.onError) {
        config.onError(error);
      }
    }
  }

  function sendChatMsg(content: string) {
    if (!isConnected.value || !wsInstance) {
      console.warn('Cannot send message - WebSocket not connected');
      return;
    }

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
