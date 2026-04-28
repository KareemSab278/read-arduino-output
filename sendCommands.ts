import { Platform } from "react-native";

let UsbSerialPort: any;

if (Platform.OS === "android") {
  UsbSerialPort = require("react-native-usb-serialport-for-android");
}

const commands: { [key: string]: string } = {
  UNLOCK: "u",
  LOCK: "l",
};

// use lsusb on linux to find out
// VID = 2341
// PID = 0042
const ARDUINO_PRODUCT_ID = 0x0042;
const ARDUINO_VENDOR_ID = 0x2341;

const getDeviceId = async (): Promise<number | null> => {
  if (Platform.OS !== "android" || !UsbSerialPort) {
    return null;
  }

  const devices = await UsbSerialPort.UsbSerialManager.list();
  if (!Array.isArray(devices)) {
    return null;
  }

  for (const device of devices) {
    if (
      device?.productId === ARDUINO_PRODUCT_ID &&
      device?.vendorId === ARDUINO_VENDOR_ID
    ) {
      return device.deviceId ?? null;
    }
  }

  return null;
};

const openUsbSerialPort = async () => {
  if (Platform.OS !== "android" || !UsbSerialPort) {
    throw new Error("USB serial is only available on Android.");
  }

  const deviceId = await getDeviceId();
  if (deviceId === null) {
    throw new Error("USB serial device not found.");
  }

  await UsbSerialPort.UsbSerialManager.tryRequestPermission(deviceId);

  const usbSerialport = await UsbSerialPort.UsbSerialManager.open(deviceId, {
    baudRate: 115200,
    parity: UsbSerialPort.Parity.None,
    dataBits: 8,
    stopBits: 1,
  });

  return { usbSerialport, deviceId };
};

const closeUsbSerialPort = async (usbSerialport: any, deviceId: number) => {
  if (usbSerialport?.close) {
    await usbSerialport.close();
    return;
  }

  if (UsbSerialPort?.UsbSerialManager?.close) {
    await UsbSerialPort.UsbSerialManager.close(deviceId);
  }
};

const writeUsbSerial = async (usbSerialport: any, payload: string) => {
  if (!usbSerialport?.write) {
    throw new Error("USB serial port does not support write().");
  }

  await usbSerialport.write(payload);
};

export const sendCommand = async (command: string): Promise<void> => {
  const payload = commands[command] ?? command;
  const { usbSerialport, deviceId } = await openUsbSerialPort();

  try {
    await writeUsbSerial(usbSerialport, payload);
    console.log(`Command sent: ${payload}`);
  } finally {
    await closeUsbSerialPort(usbSerialport, deviceId);
  }
};
