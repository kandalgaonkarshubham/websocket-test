export const useUser = () => {
  const user = useState('user', () => null);

  const fetchUser = async () => {
    try {
      const timestamp = Date.now();
      const response = {
        id: timestamp,
        displayName: `test User ${timestamp}`,
        firstName: 'test',
        lastName: 'User',
        email: `testUser${timestamp}@gmail.com`
      };
      user.value = response;
      return response;
    } catch (err) {
      throw err;
    }
  };
  return {
    user,
    fetchUser
  };
};
