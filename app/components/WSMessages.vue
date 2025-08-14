<template>
  <div ref="messagesContainer" class="space-y-2">
    <div
      v-for="(message, index) in messages"
      :key="index"
      class="flex"
      :class="
        message.sender.email === currentUser.email
          ? 'justify-end'
          : 'justify-start'
      "
    >
      <div
        class="max-w-[80%] rounded-lg p-4"
        :class="[
          message.sender.email === currentUser.email
            ? 'bg-primary-500 text-white'
            : 'bg-gray-100 dark:bg-gray-700'
        ]"
      >
        <div class="flex justify-between items-center mb-1.5">
          <span
            class="font-semibold text-sm"
            :class="
              message.sender.email === currentUser.email
                ? 'text-white'
                : 'text-gray-800 dark:text-gray-200'
            "
          >
            {{ message.sender.name }}
          </span>
          <span
            class="text-xs ml-4"
            :class="
              message.sender.email === currentUser.email
                ? 'text-white/80'
                : 'text-gray-500 dark:text-gray-400'
            "
          >
            {{ formatTime(message.timestamp) }}
          </span>
        </div>
        <p class="text-base leading-relaxed whitespace-pre-wrap">
          {{ message.content }}
        </p>
      </div>
    </div>

    <div v-if="status !== 'OPEN'" class="text-center py-2">
      <div class="text-sm text-gray-500">
        <span v-if="status === 'CONNECTING'">Connecting...</span>
        <UButton v-else-if="status === 'DISCONNECTED'" label="Disconnected" :loading="loading" @click="connect"/>
        <span v-else-if="status === 'ERROR'">Connection error</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useWS } from '~/composables/useWS';

const props = defineProps({
  did: {
    type: String,
    required: true
  },
  verticalKey: {
    type: String,
    required: true
  },
  currentUser: {
    type: Object,
    required: true
  }
});

const { loading, messages, sendChat, status, connect, disconnect } = useWS({
  decisionId: props.did,
  verticalKey: props.verticalKey,
  currentUser: props.currentUser,
  autoReconnect: true,
  onConnected: () => {
    console.log(`Connected to decision ${props.did} chat room`);
  },
  onError: (error) => {
    console.error('WebSocket error:', error);
  }
});

function formatTime(date: string) {
  return new Intl.DateTimeFormat('default', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(new Date(date));
}

function handleSend(content: string) {
  sendChat(content);
}

onMounted(async () => {
  await connect();
});

onBeforeUnmount(() => {
  disconnect();
});

defineExpose({
  handleSend
});
</script>
