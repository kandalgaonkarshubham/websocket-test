<template>
  <div class="min-h-screen py-4">
    <UContainer class="h-[90vh]">
      <UCard
        :ui="{ body: 'flex-1 overflow-y-auto py-4' }"
        class="h-full flex flex-col"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h1 class="text-xl font-bold">Chat</h1>
            <div v-if="did > -1 && verticalKey" class="text-sm text-gray-500">
              Room: {{ did + '__' + verticalKey }}
            </div>
          </div>
        </template>

        <!-- Messages Container -->
        <WSMessages
          v-if="did > -1 && verticalKey && user?.email"
          ref="messagesComponent"
          :current-user="user"
          :did="did"
          :vertical-key="verticalKey"
        />

        <template #footer>
          <div class="relative">
            <UTextarea
              v-model="newMessage"
              placeholder="Type your message..."
              :ui="{ base: 'min-h-30' }"
              class="w-full"
              :rows="2"
              autofocus
              @keydown.enter.prevent="handleTextareaEnter"
            />
            <UButton
              :disabled="!newMessage.trim()"
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
const did = 1;
const verticalKey = 'generic';

const { fetchUser, user } = useUser();

const messagesComponent = ref(null);

const newMessage = ref('');
const messagesContainer = ref(null);

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
  if (newMessage.value.trim() && messagesComponent.value) {
    messagesComponent.value.handleSend(newMessage.value.trim());
    newMessage.value = '';
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

onMounted(async () => {
  scrollToBottom();
  await fetchUser();
});
</script>
