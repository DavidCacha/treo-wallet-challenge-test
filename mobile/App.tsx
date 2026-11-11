import { StatusBar } from 'expo-status-bar';
import { AppProviders } from './src/AppProviders';
import { AppRoot } from './src/AppRoot';
import { PrivacyGuard } from './src/components/PrivacyGuard';

export default function App() {
  return (
    <AppProviders>
      <StatusBar style="dark" />
      <PrivacyGuard>
        <AppRoot />
      </PrivacyGuard>
    </AppProviders>
  );
}
