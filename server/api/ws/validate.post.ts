import crypto from 'crypto';

const WEBSOCKET_SECRET = process.env.NUXT_WEBSOCKET_SECRET!;

function createHmacToken(
  decisionId: string,
  verticalKey: string,
  email: string
) {
  const data = `${decisionId}:${verticalKey}:${email}`;
  return crypto
    .createHmac('sha256', WEBSOCKET_SECRET)
    .update(data)
    .digest('hex');
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  const { decisionId, verticalKey } = body;

  const user = {
    id: 1,
    displayName: 'test User',
    firstName: 'test',
    lastName: 'User',
    email: 'testUser@gmail.com'
  }

  const hasAccess = true;
  if (!hasAccess) {
    return createError({
      statusCode: 403,
      statusMessage: 'You do not have access to this decision.'
    });
  }

  // Generate a hmac token
  const token = createHmacToken(decisionId, verticalKey, user.email);

  return {
    success: true,
    token,
    user,
    websocketUrl: process.env.NUXT_PUBLIC_WEBSOCKETS_URL
  };
});
