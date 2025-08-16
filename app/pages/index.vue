<template>
  <div class="min-h-screen py-4">
    <UModal
      title="Welcome to Chat"
      description="Enter details to join chat."
      v-model:open="showUserModal"
      :dismissible="false"
      :close="false"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField label="Name">
            <UInput
              v-model="userNameInput"
              placeholder="Enter your name"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField label="Decision Id">
            <UInput
              v-model="chatRoomInput"
              placeholder="Enter chat Decision Id"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton
          color="primary"
          block
          :disabled="!userNameInput.trim() || !chatRoomInput.trim()"
          @click="joinChatRoom"
        >
          Join Chat
        </UButton>
      </template>
    </UModal>

    <UContainer class="h-[90vh]">
      <UCard
        :ui="{ body: 'flex-1 overflow-y-auto py-4' }"
        class="h-full flex flex-col"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h1 class="text-xl font-bold">
              <span v-if="did && verticalKey">Room: {{ did + '__' + verticalKey }}</span>
            </h1>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1">
                <div
                  class="w-2 h-2 rounded-full"
                  :class="{
                    'bg-green-500': status === 'CONNECTED',
                    'bg-yellow-500': status === 'CONNECTING',
                    'bg-red-500': status === 'ERROR',
                    'bg-gray-400': status === 'DISCONNECTED'
                  }"
                ></div>
                <span class="text-xs text-gray-600">{{ status }}</span>
              </div>
              <UButton
                v-if="status === 'DISCONNECTED' || status === 'ERROR'"
                size="sm"
                variant="outline"
                :loading="loading"
                @click="handleConnect"
              >
                Reconnect
              </UButton>
              <UButton
                v-else-if="status === 'CONNECTED'"
                size="sm"
                variant="outline"
                color="red"
                @click="handleDisconnect"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </template>

        <!-- Messages Container -->
        <WSMessages
          v-if="did && verticalKey && user?.email"
          :messages="messages"
          :current-user="user"
          :status="status"
          :loading="loading"
          @connect="handleConnect"
        />

        <template #footer>
          <div class="relative">
            <UTextarea
              v-model="newMessage"
              placeholder="Type your message..."
              :ui="{ base: 'min-h-30' }"
              class="w-full"
              :rows="2"
              :disabled="!isConnected"
              autofocus
              @keydown.enter.prevent="handleTextareaEnter"
            />
            <UButton
              :disabled="!newMessage.trim() || !isConnected"
              icon="i-heroicons-paper-airplane"
              class="absolute right-2 bottom-2"
              variant="solid"
              size="sm"
              @click="sendMessage"
            />
          </div>
        </template>
      </UCard>
    </UContainer>
  </div>
</template>

<script setup>
import { useWS } from '~/composables/useWS';

const did = ref('');
const verticalKey = 'generic';

const showUserModal = ref(true);
const userNameInput = ref('');
const chatRoomInput = ref('');
const user = ref(null);
const newMessage = ref('');

// Initialize WebSocket composable
const {
  messages,
  status,
  isConnected,
  loading,
  initialize,
  connect,
  disconnect,
  sendChat,
  clearMessages
} = useWS({
  autoReconnect: true,
  onConnected: () => {
    console.log(`Connected to decision ${did.value} chat room`);
  },
  onError: (error) => {
    console.error('WebSocket error:', error);
  }
});

function handleTextareaEnter(e) {
  if (!e.shiftKey) {
    sendMessage();
  } else {
    const cursorPos = e.target.selectionStart;
    newMessage.value =
      newMessage.value.substring(0, cursorPos) +
      '\n' +
      newMessage.value.substring(cursorPos);
    nextTick(() => {
      e.target.selectionStart = e.target.selectionEnd = cursorPos + 1;
    });
  }
}

function sendMessage() {
  if (newMessage.value.trim() && isConnected.value) {
    sendChat(newMessage.value.trim());
    newMessage.value = '';
  }
}

async function joinChatRoom() {
  user.value = {
    id: userNameInput.value,
    displayName: `test User ${userNameInput.value}`,
    firstName: 'test',
    lastName: 'User',
    email: `testUser${userNameInput.value}@gmail.com`
  };
  did.value = chatRoomInput.value;
  showUserModal.value = false;

  // Initialize WebSocket with connection parameters
  const initialized = initialize(did.value, verticalKey, user.value);
  if (initialized) {
    clearMessages();
    await connect();
  }
}

async function handleConnect() {
  if (did.value && verticalKey && user.value) {
    await connect();
  }
}

function handleDisconnect() {
  disconnect();
}

// Clean up on unmount
onBeforeUnmount(() => {
  disconnect();
});
</script>
