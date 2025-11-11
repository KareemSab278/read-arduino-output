const fs = require('fs');
const { get } = require('http');
const path = require('path');

const readTxtFile = (file) => {
    try {
        const data = fs.readFileSync(file, 'utf8');
        return data;
    } catch (err) {
        console.error(`Error reading file from disk: ${err}`);
        return null;
    }
}

const getFilePath = () => {
    const weightLogsDir = './weight logs';
    const txtFiles = fs.readdirSync(weightLogsDir).filter(file => path.extname(file) === '.txt');
    return path.join(weightLogsDir, txtFiles[0]);
}

const fileContents = readTxtFile(getFilePath());


const convertRawToJson = (rawData) => {
    // RAW DATA EXAMPLE:
    // 2025-11-11 13:13:36 {"grams":-969.4,"product":"I9","event":"Removal"}
    const lines = rawData.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => {
        const dateTimeEndIndex = line.indexOf(' ') + 10;
        const dateTimeString = line.substring(0, dateTimeEndIndex).trim();
        const jsonStartIndex = line.indexOf('{');
        if (jsonStartIndex !== -1) {
            const jsonString = line.substring(jsonStartIndex);
            try {
                return { timestamp: dateTimeString, ...JSON.parse(jsonString) };
            } catch (err) {
                console.error(`Error parsing JSON: ${err}`);
                return;
            }
        }
        return null;
    }).filter(item => item !== null);
    // OUTPUT EXAMPLE:
    //     {
    //     timestamp: '2025-11-11 13:13:36',
    //     grams: -969.4,
    //     product: 'I9',
    //     event: 'Removal'
    //      }
}

const clearLogs = () => {
    // if date changes then clear previous logs
    // 2025-11-11 13:13:36 {"grams":-969.4,"product":"I9","event":"Removal"}
    const today = new Date().toISOString().split('T')[0];
    const fileDate = fileContents.split('\n').filter(line => line.trim() !== '')[fileContents.split('\n').filter(line => line.trim() !== '').length-1].split(' ')[0]; // this should get the date from the last line as YYYY-MM-DD
    if (fileDate < today) { // if filedate is less than today
    // clear logs with date lesser than today only
    fs.writeFileSync(getFilePath(), '', 'utf8');
    console.log('Logs need to be cleared.');
    }
    else {
        console.log('Logs are up to date.');
    }
}

if (fileContents !== null) {
    clearLogs();
    const jsonData = convertRawToJson(fileContents);
    console.log('data:', jsonData);
} else {
    console.log('Failed to read the file.');
}