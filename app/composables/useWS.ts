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
  autoReconnect?: boolean;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
  onMessage?: (data: unknown) => void;
};

export function useWS(config: WebSocketConfig = {}) {
  const loading = ref(false);
  const messages = ref<ChatMessage[]>([]);
  const status = ref('DISCONNECTED');
  const isConnected = ref(false);
  const currentUser = ref(null);

  let authToken = '';
  let wsInstance: unknown = null;
  let connectionParams = {
    decisionId: '',
    verticalKey: '',
    user: null
  };

  // Initialize connection parameters without connecting
  function initialize(decisionId: string, verticalKey: string, user: object) {
    connectionParams = { decisionId, verticalKey, user };
    currentUser.value = user;

    if (!decisionId || !verticalKey) {
      console.warn('WebSocket initialization - missing required values:', {
        decisionId,
        verticalKey
      });
      return false;
    }
    return true;
  }

  async function connect() {
    if (!connectionParams.decisionId || !connectionParams.verticalKey) {
      console.error('Cannot connect - WebSocket not initialized. Call initialize() first.');
      return;
    }

    if (isConnected.value || loading.value) {
      console.log('WebSocket already connected or connecting');
      return;
    }

    loading.value = true;
    status.value = 'CONNECTING';

    try {
      // Get auth token
      const response = await $fetch('/api/ws/validate', {
        method: 'POST',
        body: {
          decisionId: connectionParams.decisionId,
          verticalKey: connectionParams.verticalKey
        }
      });

      if (!response.success) throw new Error('Token fetch failed');
      authToken = response.token;
      currentUser.value = response.user;

      // Create protocol
      const connectionData = `${connectionParams.decisionId}:${connectionParams.verticalKey}:${currentUser.value.email}:${authToken}`;
      const protocol = btoa(connectionData);

      // Connect to Durable Object directly
      wsInstance = useWebSocket(response.websocketUrl, {
        protocols: [protocol.replaceAll('=', ''), 'chat'],
        autoReconnect: config.autoReconnect ?? false,
        immediate: false, // Don't connect immediately
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

      // Small delay then open connection
      await new Promise((r) => setTimeout(r, 500));
      wsInstance.open();
    } catch (error) {
      console.error('Failed to connect:', error);
      status.value = 'ERROR';
      if (config.onError) {
        config.onError(error);
      }
    } finally {
      loading.value = false;
    }
  }

  function sendChat(content: string) {
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
    isConnected.value = false;
    status.value = 'DISCONNECTED';
  }

  function clearMessages() {
    messages.value = [];
  }

  return {
    // State
    messages: readonly(messages),
    status: readonly(status),
    isConnected: readonly(isConnected),
    loading: readonly(loading),

    // Actions
    initialize,
    connect,
    disconnect,
    sendChat,
    sendMessage,
    clearMessages
  };
}
