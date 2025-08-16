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

    <!-- Connection Status Messages -->
    <div v-if="status !== 'CONNECTED'" class="text-center py-4">
      <div class="text-sm text-gray-500">
        <div v-if="status === 'CONNECTING'" class="flex items-center justify-center gap-2">
          <div class="animate-spin w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full"></div>
          <span>Connecting to chat...</span>
        </div>
        <div v-else-if="status === 'DISCONNECTED'" class="flex flex-col items-center gap-2">
          <span>Disconnected from chat</span>
          <UButton
            size="sm"
            variant="outline"
            :loading="loading"
            @click="$emit('connect')"
          >
            Connect
          </UButton>
        </div>
        <div v-else-if="status === 'ERROR'" class="flex flex-col items-center gap-2">
          <span class="text-red-500">Connection error</span>
          <UButton
            size="sm"
            variant="outline"
            color="red"
            :loading="loading"
            @click="$emit('connect')"
          >
            Retry Connection
          </UButton>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="messages.length === 0" class="text-center py-8">
      <div class="text-gray-500 text-sm">
        <p>No messages yet</p>
        <p class="text-xs mt-1">Start the conversation!</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  messages: {
    type: Array,
    required: true
  },
  currentUser: {
    type: Object,
    required: true
  },
  status: {
    type: String,
    required: true
  },
  loading: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['connect']);

const messagesContainer = ref(null);

function formatTime(date: string) {
  return new Intl.DateTimeFormat('default', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(new Date(date));
}

function scrollToBottom() {
  if (messagesContainer.value) {
    nextTick(() => {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    });
  }
}

// Auto-scroll when new messages arrive
watch(() => props.messages.length, () => {
  scrollToBottom();
});

onMounted(() => {
  scrollToBottom();
});
</script>
