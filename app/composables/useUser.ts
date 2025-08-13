export const useUser = () => {
  const user = useState('user', () => null);

  const fetchUser = async () => {
    try {
      const response = {
        id: 1,
        displayName: 'test User',
        firstName: 'test',
        lastName: 'User',
        email: 'testUser@gmail.com'
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
