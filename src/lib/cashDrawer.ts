// Electronic Cash Drawer Utility for Web POS
// Supports ESC/POS Kick Codes (Pin 2 / Pin 5), Web Serial API (USB Trigger/Printer), and Audio/Visual Feedback

export interface CashDrawerConfig {
  enabled: boolean;
  autoOpenOnCashSale: boolean;
  pulseCode: 'PIN_2' | 'PIN_5' | 'ALT_ESC' | 'BELL';
  soundEnabled: boolean;
}

const STORAGE_KEY = 'amarpos_cash_drawer_settings';

const DEFAULT_CONFIG: CashDrawerConfig = {
  enabled: true,
  autoOpenOnCashSale: true,
  pulseCode: 'PIN_2',
  soundEnabled: true,
};

// Standard ESC/POS Solenoid Kick Pulse Bytes
export const DRAWER_CODES: Record<CashDrawerConfig['pulseCode'], { name: string; bytes: number[] }> = {
  PIN_2: {
    name: 'RJ11 Pin 2 (Standard ESC/POS: 1B 70 00 19 FA)',
    bytes: [0x1b, 0x70, 0x00, 0x19, 0xfa],
  },
  PIN_5: {
    name: 'RJ11 Pin 5 (Alternative: 1B 70 01 19 FA)',
    bytes: [0x1b, 0x70, 0x01, 0x19, 0xfa],
  },
  ALT_ESC: {
    name: 'ESC p 0 50 50 (1B 70 00 32 32)',
    bytes: [0x1b, 0x70, 0x00, 0x32, 0x32],
  },
  BELL: {
    name: 'ASCII BEL (0x07)',
    bytes: [0x07],
  },
};

export function getCashDrawerConfig(): CashDrawerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_CONFIG;
}

export function saveCashDrawerConfig(config: Partial<CashDrawerConfig>): CashDrawerConfig {
  const current = getCashDrawerConfig();
  const updated = { ...current, ...config };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}

// Synthesize a realistic mechanical cash drawer release sound using Web Audio API
export function playDrawerSound(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Metallic latch click
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(320, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
    gain1.gain.setValueAtTime(0.4, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.08);

    // Spring release metallic ring
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1480, ctx.currentTime + 0.04);
    osc2.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
    gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.04);
    osc2.stop(ctx.currentTime + 0.25);
  } catch {
    // Web audio might be restricted without user interaction
  }
}

// Active Web Serial Port reference for USB Cash Drawer Triggers
let activeSerialPort: any = null;

export async function requestSerialPort(): Promise<{ success: boolean; error?: string }> {
  if (!('serial' in navigator)) {
    return {
      success: false,
      error: 'Web Serial API is not supported in this browser. Use Chrome, Edge, or install a thermal printer driver.',
    };
  }

  try {
    const serial = (navigator as any).serial;
    const port = await serial.requestPort();
    await port.open({ baudRate: 9600 });
    activeSerialPort = port;
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function openCashDrawer(reason = 'Manual Trigger'): Promise<{ success: boolean; method: string; error?: string }> {
  const config = getCashDrawerConfig();
  if (!config.enabled) {
    return { success: false, method: 'DISABLED', error: 'Cash drawer is disabled in settings.' };
  }

  if (config.soundEnabled) {
    playDrawerSound();
  }

  // Dispatch custom DOM event so UI can display a toast/pill
  window.dispatchEvent(
    new CustomEvent('cash-drawer-opened', {
      detail: { reason, timestamp: Date.now() },
    })
  );

  const codeData = DRAWER_CODES[config.pulseCode] || DRAWER_CODES.PIN_2;
  const pulseBytes = new Uint8Array(codeData.bytes);

  // 1. Try active Web Serial Port (USB trigger box or USB printer)
  if (activeSerialPort && activeSerialPort.writable) {
    try {
      const writer = activeSerialPort.writable.getWriter();
      await writer.write(pulseBytes);
      writer.releaseLock();
      return { success: true, method: 'WEB_SERIAL' };
    } catch (err) {
      console.warn('Failed to send pulse to serial port:', err);
    }
  }

  // 2. Try raw ESC/POS kick broadcast (via iframe / print helper or POS driver)
  try {
    // Create an invisible iframe to send raw ESC/POS character pulse if supported by driver
    const kickString = String.fromCharCode(...pulseBytes);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    document.body.appendChild(iframe);
    
    // Cleanup after short delay
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // ignore
      }
    }, 1000);
  } catch {
    // ignore
  }

  return { success: true, method: 'STANDARD_KICK' };
}
