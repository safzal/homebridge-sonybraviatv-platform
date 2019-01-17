var http = require('http');
//var actionMap = require('./ActionMap');

/** @type {Boolean} httpDebug Debug flag */
const httpDebug = false;

/** @type {Number} DEFAULT_TIME_BETWEEN_COMMANDS Standard time between requests */
const DEFAULT_TIME_BETWEEN_COMMANDS = 350;

/** @type {Number} PAUSED_TIME_BETWEEN_COMMANDS Time to wait between long commands like home to make sure they finish */
const PAUSED_TIME_BETWEEN_COMMANDS = 3000;

/** @type {String} braviaIRCCEndPoint Endpoint to send signals to */
const braviaIRCCEndPoint = '/sony/IRCC';

/** @type {Object} actionLookUpTable Alternate action names lookup table */
const actionLookUpTable = {
    'Enter': 'Confirm'
};

class BraviaRemoteControl {

    /**
     * Create a bravia remote control instance
     * @param  {String} domain
     * @param  {Number} port
     * @param  {String} authKey
     * @return {BraviaRemoteControl}
     */
    constructor(domain, port, authKey = '0000') {
        this.debug = false;
        this.domain = domain;
        this.port = port;
        this.authKey = authKey;
        this.activeRequest = false;
        this.activeSequence = false;
        this.delay = DEFAULT_TIME_BETWEEN_COMMANDS;
        this.openedApp = null;
    }

    /**
     * Get the remote IRCCCode control values
     * @param  {String} actionName
     * @return {String|Boolean} IRCCCode
     */
    static getIRCCCode(actionName) {
        return actionMap[actionName] ? actionMap[actionName] : false;
    }

    /**
     * Send a sequence of commands
     * @param  {String} actionKeySeq sequence of commands e.g 'down up left right'
     * @return {Promise}
     */
    sendActionSequence(actionKeySeq) {
        let commands = actionKeySeq.split(' ');

        // Fire off the commands synchronously
        return new Promise((resolve, reject) => {
            this.activeSequence = true;
            let index = 0;

            let next = () => {
                if (index < commands.length) {
                    this.sendAction(commands[index++]).then(next, reject);
                } else {
                    console.log(`Sequence '${actionKeySeq}' finished.`);
                    this.activeSequence = false;
                    resolve();
                }
            }

            next();
        });
    }

    /**
     * Send a sequence of commands that navigates to an open that
     * will open. Command starts with home, long pause, sequence, then confirm.
     * @param  {string} actionKeySeq
     * @param  {string} appName
     * @return {Promise}
     */
    openAppSeq(actionKeySeq, appName) {
        this.delay = PAUSED_TIME_BETWEEN_COMMANDS; // Set longer delay

        return this.sendActionSequence('exit home')
            .then(() => {
                this.delay = DEFAULT_TIME_BETWEEN_COMMANDS;
                return this.sendActionSequence(actionKeySeq);
            })
            .then(() => {
                this.openedApp = appName;
                return this.sendActionSequence('confirm')
                    .then(() => console.log(`${appName} was opened`));
            });
    }

    /**
     * Send an IRCC signal to the TV by looking up
     * @param  {String} actionKey
     * @return {Promise}
     */
    sendAction(actionKey) {
        let action = this.getAction(actionKey);
        return this.sendIRCCSignal(BraviaRemoteControl.getIRCCCode(action));
    }

    /**
     * Send an IRCC signal to the TV
     * @param  {String} actionKey
     * @return {Promise}
     */
    sendIRCCSignal(IRCCCode) {
        let body = this.getIRCCCodeXMLBody(IRCCCode);
        let options = this.getRequestOptions();
        return this.sendHTTPRequest(options, body);
    }

    /**
     * Send an HTTP Request to a Bravia TV with timeout
     * @param  {Object} options
     * @param  {String} body
     * @return {Promise}
     */
    sendHTTPRequest(options, body) {
        return new Promise((resolve, reject) => {
            let req = http.request(options, (res) => {
                this.activeRequest = true;

                if (httpDebug) console.log(`STATUS: ${res.statusCode}`);
                if (httpDebug) console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
                res.setEncoding('utf8');

                res.on('data', (chunk) => {
                    if (httpDebug) console.log(`BODY: ${chunk}`);
                });

                res.on('end', () => {
                    this.activeRequest = false;
                    setTimeout(() => {
                        resolve();
                    }, this.delay);
                });
            });

            req.on('error', (e) => {
                reject(`problem with request: ${e.message}`);
            });

            req.write(body);
            req.end();
        });
    }

    /**
     * Build the HTTP request options
     * @return {Object}
     */
    getRequestOptions() {
        return {
            hostname: this.domain,
            port: this.port,
            path: braviaIRCCEndPoint,
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
                'soapaction': '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
                'x-auth-psk': this.authKey
            }
        }
    }

    /**
     * Get the xml body for the http response sent to the bravia television
     * @param  {String} IRCCCode
     * @return {String}
     */
    getIRCCCodeXMLBody(IRCCCode) {
        return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>${IRCCCode}</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>`;
    }

    /**
     * Determines if an action is valid
     * @param  {String}  action
     * @return {Boolean}
     */
    isValidAction(action) {
        return actionMap[this.getAction(action)] !== undefined;
    }

    /**
     * Check the lookup table for an alternate action name
     * @param  {string} action
     * @return {string}
     */
    getAction(action) {
        return actionLookUpTable[action] ? actionLookUpTable[action] : action;
    }

}

module.exports = BraviaRemoteControl;

var actionMap = {
    PowerOn: 'AAAAAQAAAAEAAAAuAw==',
    Num1: 'AAAAAQAAAAEAAAAAAw==',
    Num2: 'AAAAAQAAAAEAAAABAw==',
    Num3: 'AAAAAQAAAAEAAAACAw==',
    Num4: 'AAAAAQAAAAEAAAADAw==',
    Num5: 'AAAAAQAAAAEAAAAEAw==',
    Num6: 'AAAAAQAAAAEAAAAFAw==',
    Num7: 'AAAAAQAAAAEAAAAGAw==',
    Num8: 'AAAAAQAAAAEAAAAHAw==',
    Num9: 'AAAAAQAAAAEAAAAIAw==',
    Num0: 'AAAAAQAAAAEAAAAJAw==',
    Num11: 'AAAAAQAAAAEAAAAKAw==',
    Num12: 'AAAAAQAAAAEAAAALAw==',
    Enter: 'AAAAAQAAAAEAAAALAw==',
    GGuide: 'AAAAAQAAAAEAAAAOAw==',
    ChannelUp: 'AAAAAQAAAAEAAAAQAw==',
    ChannelDown: 'AAAAAQAAAAEAAAARAw==',
    VolumeUp: 'AAAAAQAAAAEAAAASAw==',
    VolumeDown: 'AAAAAQAAAAEAAAATAw==',
    Mute: 'AAAAAQAAAAEAAAAUAw==',
    TvPower: 'AAAAAQAAAAEAAAAVAw==',
    Audio: 'AAAAAQAAAAEAAAAXAw==',
    MediaAudioTrack: 'AAAAAQAAAAEAAAAXAw==',
    Tv: 'AAAAAQAAAAEAAAAkAw==',
    Input: 'AAAAAQAAAAEAAAAlAw==',
    TvInput: 'AAAAAQAAAAEAAAAlAw==',
    TvAntennaCable: 'AAAAAQAAAAEAAAAqAw==',
    WakeUp: 'AAAAAQAAAAEAAAAuAw==',
    PowerOff: 'AAAAAQAAAAEAAAAvAw==',
    Sleep: 'AAAAAQAAAAEAAAAvAw==',
    Right: 'AAAAAQAAAAEAAAAzAw==',
    Left: 'AAAAAQAAAAEAAAA0Aw==',
    SleepTimer: 'AAAAAQAAAAEAAAA2Aw==',
    Analog2: 'AAAAAQAAAAEAAAA4Aw==',
    TvAnalog: 'AAAAAQAAAAEAAAA4Aw==',
    Display: 'AAAAAQAAAAEAAAA6Aw==',
    Jump: 'AAAAAQAAAAEAAAA7Aw==',
    PicOff: 'AAAAAQAAAAEAAAA+Aw==',
    PictureOff: 'AAAAAQAAAAEAAAA+Aw==',
    Teletext: 'AAAAAQAAAAEAAAA/Aw==',
    Video1: 'AAAAAQAAAAEAAABAAw==',
    Video2: 'AAAAAQAAAAEAAABBAw==',
    AnalogRgb1: 'AAAAAQAAAAEAAABDAw==',
    Home: 'AAAAAQAAAAEAAABgAw==',
    Exit: 'AAAAAQAAAAEAAABjAw==',
    PictureMode: 'AAAAAQAAAAEAAABkAw==',
    Confirm: 'AAAAAQAAAAEAAABlAw==',
    Up: 'AAAAAQAAAAEAAAB0Aw==',
    Down: 'AAAAAQAAAAEAAAB1Aw==',
    ClosedCaption: 'AAAAAgAAAKQAAAAQAw==',
    Component1: 'AAAAAgAAAKQAAAA2Aw==',
    Component2: 'AAAAAgAAAKQAAAA3Aw==',
    Wide: 'AAAAAgAAAKQAAAA9Aw==',
    EPG: 'AAAAAgAAAKQAAABbAw==',
    PAP: 'AAAAAgAAAKQAAAB3Aw==',
    TenKey: 'AAAAAgAAAJcAAAAMAw==',
    BSCS: 'AAAAAgAAAJcAAAAQAw==',
    Ddata: 'AAAAAgAAAJcAAAAVAw==',
    Stop: 'AAAAAgAAAJcAAAAYAw==',
    Pause: 'AAAAAgAAAJcAAAAZAw==',
    Play: 'AAAAAgAAAJcAAAAaAw==',
    Rewind: 'AAAAAgAAAJcAAAAbAw==',
    Forward: 'AAAAAgAAAJcAAAAcAw==',
    DOT: 'AAAAAgAAAJcAAAAdAw==',
    Rec: 'AAAAAgAAAJcAAAAgAw==',
    Return: 'AAAAAgAAAJcAAAAjAw==',
    Blue: 'AAAAAgAAAJcAAAAkAw==',
    Red: 'AAAAAgAAAJcAAAAlAw==',
    Green: 'AAAAAgAAAJcAAAAmAw==',
    Yellow: 'AAAAAgAAAJcAAAAnAw==',
    SubTitle: 'AAAAAgAAAJcAAAAoAw==',
    CS: 'AAAAAgAAAJcAAAArAw==',
    BS: 'AAAAAgAAAJcAAAAsAw==',
    Digital: 'AAAAAgAAAJcAAAAyAw==',
    Options: 'AAAAAgAAAJcAAAA2Aw==',
    Media: 'AAAAAgAAAJcAAAA4Aw==',
    Prev: 'AAAAAgAAAJcAAAA8Aw==',
    Next: 'AAAAAgAAAJcAAAA9Aw==',
    DpadCenter: 'AAAAAgAAAJcAAABKAw==',
    CursorUp: 'AAAAAgAAAJcAAABPAw==',
    CursorDown: 'AAAAAgAAAJcAAABQAw==',
    CursorLeft: 'AAAAAgAAAJcAAABNAw==',
    CursorRight: 'AAAAAgAAAJcAAABOAw==',
    ShopRemoteControlForcedDynamic: 'AAAAAgAAAJcAAABqAw==',
    FlashPlus: 'AAAAAgAAAJcAAAB4Aw==',
    FlashMinus: 'AAAAAgAAAJcAAAB5Aw==',
    AudioQualityMode: 'AAAAAgAAAJcAAAB7Aw==',
    DemoMode: 'AAAAAgAAAJcAAAB8Aw==',
    Analog: 'AAAAAgAAAHcAAAANAw==',
    Mode3D: 'AAAAAgAAAHcAAABNAw==',
    DigitalToggle: 'AAAAAgAAAHcAAABSAw==',
    DemoSurround: 'AAAAAgAAAHcAAAB7Aw==',
    '*AD': 'AAAAAgAAABoAAAA7Aw==',
    AudioMixUp: 'AAAAAgAAABoAAAA8Aw==',
    AudioMixDown: 'AAAAAgAAABoAAAA9Aw==',
    PhotoFrame: 'AAAAAgAAABoAAABVAw==',
    Tv_Radio: 'AAAAAgAAABoAAABXAw==',
    SyncMenu: 'AAAAAgAAABoAAABYAw==',
    Hdmi1: 'AAAAAgAAABoAAABaAw==',
    Hdmi2: 'AAAAAgAAABoAAABbAw==',
    Hdmi3: 'AAAAAgAAABoAAABcAw==',
    Hdmi4: 'AAAAAgAAABoAAABdAw==',
    TopMenu: 'AAAAAgAAABoAAABgAw==',
    PopUpMenu: 'AAAAAgAAABoAAABhAw==',
    OneTouchTimeRec: 'AAAAAgAAABoAAABkAw==',
    OneTouchView: 'AAAAAgAAABoAAABlAw==',
    DUX: 'AAAAAgAAABoAAABzAw==',
    FootballMode: 'AAAAAgAAABoAAAB2Aw==',
    iManual: 'AAAAAgAAABoAAAB7Aw==',
    Netflix: 'AAAAAgAAABoAAAB8Aw==',
    Assists: 'AAAAAgAAAMQAAAA7Aw==',
    ActionMenu: 'AAAAAgAAAMQAAABLAw==',
    Help: 'AAAAAgAAAMQAAABNAw==',
    TvSatellite: 'AAAAAgAAAMQAAABOAw==',
    WirelessSubwoofer: 'AAAAAgAAAMQAAAB+Aw=='
}