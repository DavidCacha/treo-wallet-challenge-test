import { useAuth } from './auth/AuthContext';
import { LoadingState } from './components/States';
import { NavigationProvider, useNav } from './navigation';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { TransferFormScreen } from './screens/TransferFormScreen';
import { TransferReviewScreen } from './screens/TransferReviewScreen';
import { TransferStatusScreen } from './screens/TransferStatusScreen';
import { TransferProvider } from './transfer/TransferContext';

function SignedInStack() {
  const { route } = useNav();
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'transferForm':
      return <TransferFormScreen initial={route.values} />;
    case 'transferReview':
      return <TransferReviewScreen draft={route.draft} />;
    case 'transferStatus':
      return <TransferStatusScreen values={route.values} />;
  }
}

export function AppRoot() {
  const { status } = useAuth();
  if (status === 'restoring') return <LoadingState label="Abriendo sesión…" />;
  if (status === 'signedOut') return <LoginScreen />;
  return (
    <TransferProvider>
      <NavigationProvider initial={{ name: 'home' }}>
        <SignedInStack />
      </NavigationProvider>
    </TransferProvider>
  );
}
