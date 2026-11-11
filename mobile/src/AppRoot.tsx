import { useAuth } from './auth/AuthContext';
import { LoadingState } from './components/States';
import { NavigationProvider, useNav } from './navigation';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';

function SignedInStack() {
  const { route } = useNav();
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
  }
}

export function AppRoot() {
  const { status } = useAuth();
  if (status === 'restoring') return <LoadingState label="Abriendo sesión…" />;
  if (status === 'signedOut') return <LoginScreen />;
  return (
    <NavigationProvider initial={{ name: 'home' }}>
      <SignedInStack />
    </NavigationProvider>
  );
}
