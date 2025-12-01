export { getWeightBoardLogs };
import { createAsyncThunk } from "@reduxjs/toolkit";
import { Platform } from "react-native";
import { HexToString } from "./HexToString";
import { planogram, mapProductPositions } from "../data/planogram";
import { UpdateCart } from "./UpdateCart";
let UsbSerialPort;


// use lsusb on linux to find out 
// VID = 2341
// PID = 0042
const ARDUINO_PRODUCT_ID = 0x0042;
const ARDUINO_VENDOR_ID = 0x2341;
const similarWeightMargin = 20;
const takeErrorMargin = 50;

if (Platform.OS === "android") {
  UsbSerialPort = require("react-native-usb-serialport-for-android");
}

const { UsbSerialManager, Parity } = UsbSerialPort;


class WeightStack {
  constructor() {
    this.items = [];
  }

  push(element) {
    this.items.push(element);
  }

  pop() {
    if (this.isEmpty()) {
      return null;
    }
    return this.items.pop();
  }

  peek() {
    if (this.isEmpty()) {
      return null;
    }
    return this.items[this.items.length - 1];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }

  clear() {
    this.items = [];
  }

  getProductWeightFromStack = (product) => {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].product === product) {
        return this.items[i].weight;
      }
    }
    return null;

  };

  showStack() {
    return this.items;
  }

  removeAllForProduct(product) {
    this.items = this.items.filter(item => item.product !== product);
  }
}
const weightsStack = new WeightStack();




const currDateTime = (date = new Date()) => {
  const pad = n => String(n).padStart(2, '0');
  return (
    date.getFullYear() + '-' +
    pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' +
    pad(date.getMinutes()) + ':' +
    pad(date.getSeconds())
  );
}

const convertRawToJson = (rawData) => {
  const lines = rawData.split('\n').filter(line => line.trim() !== '');
  return lines.map(line => {
    try {
      const obj = JSON.parse(line);
      return { timestamp: currDateTime(), ...obj };
    } catch (err) {
      console.error(`Error parsing JSON: ${err}`);
      return null;
    }
  }).filter(item => item !== null);
};


const logEverything = (parsedLogs, getState) => {
  console.log(JSON.stringify({
    timestamp: currDateTime() || 'N/A',
    stackSize: weightsStack.size() || 0,
    stackItems: JSON.parse(JSON.stringify(weightsStack.showStack())) || 'N/A',
    cartLength: getState().main.cart.length || 0,
    product: parsedLogs?.product || 'N/A',
    grams: parsedLogs?.grams || 'N/A',
    action: parsedLogs?.action || 'N/A',
    shelf: parsedLogs?.shelf || 'N/A',
    peek: weightsStack.peek() || 'N/A',
  }, null, 2));
}

const getWeightBoardLogs = createAsyncThunk(
  "weightBoard/get_logs",
  async (_, { dispatch, getState }) => {
    try {
      const devices = await UsbSerialManager.list();
      let device_id = 0;
      devices.forEach((device) => {
        if (device?.productId == ARDUINO_PRODUCT_ID && device?.vendorId == ARDUINO_VENDOR_ID) {
          device_id = device?.deviceId || device_id;
        }
      });

      await UsbSerialManager.tryRequestPermission(device_id);

      const usbSerialport = await UsbSerialManager.open(device_id, {
        baudRate: 115200,
        parity: Parity.None,
        dataBits: 8,
        stopBits: 1,
      });

      let dataBuffer = '';

      usbSerialport.onReceived((event) => {
        try {
          const logData = event.data;
          const hexString = HexToString(logData);
          dataBuffer += hexString;

          const lines = dataBuffer.split('\n');

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line) {
              try {
                const parsedLogs = JSON.parse(line);
                parsedLogs.timestamp = currDateTime();

                updateCartTrigger(parsedLogs, dispatch, getState);

                dispatch({
                  type: 'main/addWeightBoardLog',
                  payload: {
                    data: parsedLogs
                  }
                });
              } catch (err) {
                console.error(`Error parsing JSON: ${err.message}`);
              }
            }
          }

          dataBuffer = lines[lines.length - 1];
        } catch (err) {
          console.error('Error processing USB data:', err);
        }
      });

    } catch (error) {
      console.error("Error in getWeightBoardLogs:", error);
    }
  }
);


const findDiffOfWeights = (a, b) => { return Math.abs(a) - Math.abs(b) }; // if x is then abs return x and if y is then abs return y and find difference


const isWeightSimilar = (parsedLogs, similarWeightMargin) => {
  const diff = findDiffOfWeights(weightsStack.getProductWeightFromStack(parsedLogs.product), parsedLogs.grams);
  if (diff <= similarWeightMargin) {
    return true;
  }
  return false;
};


const validateTakeAction = (parsedLogs, productEntry, takeErrorMargin) => {
  const weightCheck = productEntry.grams + parsedLogs.grams;
  if (weightCheck < -takeErrorMargin || weightCheck > takeErrorMargin) {
    console.log('False take action prevented with weight check ', weightCheck)
    return false;
  }
  return true;
}



const addToWeightStack = (product, weight, action, getState) => {
  const state = getState();
  if (action === 'take') {
    weightsStack.push({ product: product, weight: weight });
  } else if (action === 'put') {
    weightsStack.push({ product: product, weight: weight });
    if (!isWeightSimilar({ product: product, grams: weight }, similarWeightMargin)) {
      weightsStack.pop();
    }
    if (state.main.cart.length == 0) {
      weightsStack.clear();
      // avoids memory leak and clears stack when cart is empty
    }
  }
}




const doTakeAction = (parsedLogs, dispatch, getState, productEntry) => {
  weightsStack.getProductWeightFromStack(parsedLogs.product);

  const state = getState();
  const alreadyInCart = state.main.cart.some(
    item => item.product_id === productEntry.product_id
  );
  if (!alreadyInCart) {
    dispatch(UpdateCart({
      action: 'add',
      product: productEntry,
      time: currDateTime(),
      weight_event: parsedLogs.grams,
      shelf: parsedLogs.shelf || 'N/A'
    }));

    addToWeightStack(parsedLogs.product, parsedLogs.grams, parsedLogs.action, parsedLogs.shelf, getState);
    logEverything({ product: parsedLogs.product, grams: parsedLogs.grams, action: parsedLogs.action }, getState);
  }
}


const doPutAction = (parsedLogs, dispatch, getState, productEntry) => {

  if (isWeightSimilar(parsedLogs, similarWeightMargin)) {
    const state = getState();
    const cartItem = state.main.cart.find(
      item => item.product_id === productEntry.product_id
    );
    if (cartItem) {
      dispatch(UpdateCart({
        action: 'remove',
        cart_id: cartItem.cart_id,
        product: productEntry,
        time: currDateTime(),
        weight_event: parsedLogs.grams,
        shelf: parsedLogs.shelf || 'N/A'
      }));

      weightsStack.removeAllForProduct(parsedLogs.product);
      logEverything({ product: parsedLogs.product, grams: parsedLogs.grams, shelf: parsedLogs.shelf, action: parsedLogs.action }, getState);
    }
  }

}


const updateCartTrigger = (parsedLogs, dispatch, getState) => {
  if (parsedLogs?.action && parsedLogs.product) {
    const state = getState();
    const productEntry = mapProductPositions(parsedLogs.product, planogram, state.main.products, parsedLogs.shelf);
    if (productEntry) {
      productEntry.weight_event = parsedLogs.grams && productEntry.shelf === parsedLogs.shelf;

      if (parsedLogs?.action === 'take') {
        if (validateTakeAction(parsedLogs, productEntry, takeErrorMargin)) {
          doTakeAction(parsedLogs, dispatch, getState, productEntry);
        }

        logEverything({ product: parsedLogs.product, grams: parsedLogs.grams, shelf: parsedLogs.shelf, action: parsedLogs.action }, getState);


      } else if (parsedLogs?.action === 'put') {

        doPutAction(parsedLogs, dispatch, getState, productEntry);

        logEverything({ product: parsedLogs.product, grams: parsedLogs.grams, shelf: parsedLogs.shelf, action: parsedLogs.action }, getState);
      }
    }
  }
};
