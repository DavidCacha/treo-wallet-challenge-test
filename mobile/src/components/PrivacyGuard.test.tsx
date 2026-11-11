import { act, screen } from '@testing-library/react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { AppState, Platform, Text } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { renderWithProviders } from '../test/helpers';
import { PrivacyGuard } from './PrivacyGuard';

let emit: (s: AppStateStatus) => void = () => undefined;

beforeEach(() => {
  // El mock de React Native en Jest no expone currentState como cadena.
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
    writable: true,
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    emit = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => jest.restoreAllMocks());

const ui = (
  <PrivacyGuard>
    <Text>$93,249.51</Text>
  </PrivacyGuard>
);

describe('PrivacyGuard [NFR-13]', () => {
  it('con la app activa muestra el contenido sin cubierta', async () => {
    await renderWithProviders(ui);
    expect(screen.getByText('$93,249.51')).toBeVisible();
    expect(screen.queryByTestId('privacy-cover')).not.toBeOnTheScreen();
  });

  it('al pasar a segundo plano muestra la cubierta y oculta los saldos', async () => {
    await renderWithProviders(ui);
    await act(async () => emit('background'));
    expect(screen.getByTestId('privacy-cover')).toBeOnTheScreen();
    expect(screen.getByText('Contenido oculto por privacidad')).toBeVisible();
    // Sigue montado (no se pierde el estado) pero oculto, también para lectores de pantalla.
    expect(screen.queryByText('$93,249.51')).not.toBeOnTheScreen();
    expect(screen.getByText('$93,249.51', { includeHiddenElements: true })).not.toBeVisible();
  });

  it('en iOS "inactive" (selector de apps) también cubre; al volver a activa se quita', async () => {
    await renderWithProviders(ui);
    await act(async () => emit('inactive'));
    expect(screen.getByTestId('privacy-cover')).toBeOnTheScreen();
    await act(async () => emit('active'));
    expect(screen.queryByTestId('privacy-cover')).not.toBeOnTheScreen();
    expect(screen.getByText('$93,249.51')).toBeVisible();
  });

  it('en Android marca la ventana como segura para que "Recientes" no muestre saldos', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderWithProviders(ui);
    expect(usePreventScreenCapture).toHaveBeenCalledWith('treo-privacy');
  });

  it('en iOS no bloquea capturas: basta la cubierta (iOS avisa "inactive" antes de la miniatura)', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    (usePreventScreenCapture as jest.Mock).mockClear();
    await renderWithProviders(ui);
    expect(usePreventScreenCapture).not.toHaveBeenCalled();
  });
});
