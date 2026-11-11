import { StatusBar } from 'expo-status-bar';
import { AppProviders } from './src/AppProviders';
import { AppRoot } from './src/AppRoot';

export default function App() {
  return (
    <AppProviders>
      <StatusBar style="dark" />
      <AppRoot />
    </AppProviders>
  );
}
