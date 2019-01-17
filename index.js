// SonyBraviaTv Platform Shim for HomeBridge
//
// Remember to add platform to config.json. Example:
//
"use strict";

var request = require("request");
var wol = require("wake_on_lan");
var BraviaRemoteControl = require('./BraviaRemoteControl');

var fs = require('fs');
var path = require('path');

var Service, Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerPlatform("homebridge-sonybraviatv", "SonyTV", SonyBraviaTvPlatform);
}

function SonyBraviaTvPlatform(log, config) {
    this.log = log;
    this.name = config["name"];
    this.psk = config["presharedkey"] || '0000';
    this.ipAddress = config["ipaddress"];
    this.macAddress = config["macaddress"];
    this.polling = config["polling"] === true;
    this.buttons = config["buttons"];
    this.log("Sony Bravia TV Platform Plugin Version " + this.getVersion());
    this.modelName = "ICS-1000";
    this.config = config;
}

function SonyBraviaTvAccessory(log, config, button, api, powerButton) {
    this.log = log;
    if (button.onCommand) {
        this.onCode = button.onCommand;
        this.offCode = button.offCommand ? button.offCommand : button.onCommand;
    }
    if (button.onUri) {
        this.onUri = button.onUri;
        this.offUri = button.offUri ? button.offUri : button.onUri;
    }
    var bName = button.name ? " " + button.name : "";
    this.name = config["name"] + bName;
    this.mainName = config["name"];
    this.button = button;
    this.isTvPowerButton = powerButton; // when no name of the button it will be name
    this.isVolume = (button.buttonType.indexOf('V') > -1);
    this.isChannel = (button.buttonType.indexOf('C') > -1);
    this.isSwitch = (button.buttonType.indexOf('S') > -1 || button.buttonType.indexOf('O') > -1);
    this.status = 0; // 0 = off, else on / percentage
    this.isMute = 1; // 0 = off, else on / percentage
    this.previousPercentage = 0;
    this.isTvOn = false;
    this.volumeInProgress = false;
    this.api = api;
    this.psk = config["presharedkey"] || '0000';
    this.ipAddress = config["ipaddress"];
    this.port = config["port"] || 80;
    this.macAddress = config["macaddress"];
    this.maxVolume = config["maxVolume"] || 100;
    this.maxChannel = config["maxVolume"] || 999;
    this.polling = config["polling"] || true;
    this.interval = parseInt(config["interval"], 10) | 30;


    this.timeOut = button.timeOut ? button.timeOut : 1;
    this.timerVolume = 0;
    this.timerSpeaker = 0;

    this.runTimer();
    this.updateTimer();
}

function onErr(err) {
    console.log(err);
    return 1;
}

SonyBraviaTvPlatform.prototype = {

    accessories: function (callback) {
        this.log("Fetching Sony Bravia Tv switches and buttons...");
        var getRemoteButtons = function () {
            var api = new BraviaRemoteControl(this.ipAddress, 80, this.psk);
            var foundAccessories = [];

            var mainTv = {
                buttonType: 'S',
                name: null
            };
            console.log("Main Power Button = ");
            console.log(mainTv);
            var mainTVOnAccessory = new SonyBraviaTvAccessory(this.log, this.config, mainTv, api, true);
            foundAccessories.push(mainTVOnAccessory);

            if (this.buttons) {
                // Remote control connection
                for (var i = 0; i < this.buttons.length; ++i) {
                    var button = this.buttons[i];
                    console.log("Other Button = ");
                    console.log(button);
                    var accessory = new SonyBraviaTvAccessory(this.log, this.config, button, api, false);
                    foundAccessories.push(accessory);
                }
            }
            callback(foundAccessories);
        }.bind(this);

        getRemoteButtons();
    },

    getVersion: function () {
        var pjPath = path.join(__dirname, './package.json');
        var pj = JSON.parse(fs.readFileSync(pjPath));
        return pj.version;
    }
};

SonyBraviaTvAccessory.prototype = {

    // Respond to identify request
    identify: function (callback) {
        callback();
    },
    // Get Services
    getServices: function () {

        this.service = 0;
        //this.switchService = 0;

        this.getTvPowerOn(function (err, isOn) {
            this.isTvOn = isOn;
        }.bind(this));

        if (this.isVolume) {
            // Use HomeKit types defined in HAP node JS
            var lightbulbService = new Service.Lightbulb(this.name);

            // Basic light controls, common to Hue and Hue lux

            this.getTvVolume(function (err, value) {
                console.log("getTvVolume: " + value);
            });
            lightbulbService
                .getCharacteristic(Characteristic.On)
                .on('get', this.getTvIsMute.bind(this))
                .on('set', this.setTvToMute.bind(this))
                .value = this.isMute;
            lightbulbService
                .addCharacteristic(Characteristic.Brightness)
                .on('get', this.getTvVolume.bind(this))
                .on('set', this.setTvVolume.bind(this))
                .value = this.status;
            lightbulbService.getCharacteristic(Characteristic.Brightness)
                .setProps({minStep: 1, minValue: -50, maxValue: this.maxVolume});

            this.service = lightbulbService;
        }
        else if (this.isChannel) {
            // Use HomeKit types defined in HAP node JS
            var lightbulbService = new Service.Lightbulb(this.name);

            this.getTvChannel(function (err, value) {
                console.log("getTvChannel: " + value);
                this.status = value;
            }.bind(this));

            // Basic light controls, common to Hue and Hue lux
            lightbulbService
                .getCharacteristic(Characteristic.On)
                .on('get', this.getChannelPower.bind(this))
                .on('set', this.setChannelPower.bind(this))
                .value = this.isTvOn;

            lightbulbService
                .addCharacteristic(Characteristic.Brightness)
                .on('get', this.getTvChannel.bind(this))
                .on('set', this.setTvChannel.bind(this))
                .value = this.status;
            lightbulbService.getCharacteristic(Characteristic.Brightness)
                .setProps({minStep: 1, maxValue: this.maxChannel});


            this.service = lightbulbService;
        }
        else if (this.isSwitch) {
            // Use HomeKit types defined in HAP node JS
            var switchService = new Service.Switch(this.name);

            // Basic light controls, common to Hue and Hue lux
            if (this.isTvPowerButton) {
                switchService
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getTvPowerOn.bind(this))
                    .on('set', this.setTvPowerOn.bind(this))
                    .value = this.isTvOn;
                this.getTvPowerOn(function (err, isOn) {
                    console.log("*** Get Tv Power On: " + isOn);
                    this.isTvOn = isOn;
                    switchService.getCharacteristic(Characteristic.On).updateValue(isOn);
                }.bind(this));

            } else {
                switchService
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getButtonOn.bind(this))
                    .on('set', this.setButtonOn.bind(this))
                    .value = this.status;
            }

            this.service = switchService;
        }

        var informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "SonyBraviaTv")
            .setCharacteristic(Characteristic.Model, this.modelName)
            .setCharacteristic(Characteristic.SerialNumber, "A1S2NASF88EW" + this.name + this.onCode)//this.device.uniqueid)
            .addCharacteristic(Characteristic.FirmwareRevision, "0.0.1");

        return [informationService, this.service];
    },


    // Send code to remote controls
    setRemoteCommand: function (code) {
        var res = code.split(" ");
        if (res.length > 1) {
            // Send sequences of actions (sent synchronously with delays)
            this.api.sendActionSequence(code); // Moves down twice then presses enter
        } else {
            // Single Command
            this.api.sendAction(code); // mutes the tv
        }
    },

    // Set or Get json commands status
    setJsonCommandStatus: function (url, method, params, callback) {
        if (params === null) {
            params = "";
        }
        var postData = JSON.stringify({
            method: method,
            params: [params],
            id: 1,
            version: '1.0'
        });
        var urlAddress = "http://" + this.ipAddress + url;
        request.post({
            url: urlAddress,
            headers: {
                'X-Auth-PSK': this.psk
            },
            form: postData
        }, function (err, response, body) {
            //this.log("Json Commands Err: %s -- Response: %s -- Body: %s", err, response, body);
            if (!err && response.statusCode == 200) {
                var json = JSON.parse(body);
                callback(false, json); // success
            } else {
                if (response != null) {
                    var error = "Error getting TV status (status code " + response.statusCode + "): " + err;
                    //this.log("Json Command Status Error: %s", error);
                    callback(true, error);
                } else {
                    //this.log("* No response");
                    callback(true, {
                        "error": [21, "* No response"],
                        "id": 1
                    });
                }
            }
        }.bind(this));
    },

    setJsonContentStatus: function (setPath, setMethod, setParams, setVersion) {
        return new Promise((resolve, reject) => {
            var options = {
                host: this.ipAddress,
                port: this.port,
                family: 4,
                path: setPath,
                method: 'POST',
                headers: {
                    'X-Auth-PSK': this.psk
                }
            };

            var post_data = {
                'method': setMethod,
                'params': [setParams],
                'id': 1,
                'version': setVersion
            };

            var req = http.request(options, function (res) {
                if (res.statusCode < 200 || res.statusCode > 299) {
                    reject(new Error('Failed to load data, status code: ' + res.statusCode));
                }

                const body = [];
                res.on('data', (chunk) => body.push(chunk));
                res.on('end', () => resolve(body.join('')));
            });

            req.on('error', (err) => reject(err));

            req.write(JSON.stringify(post_data));
            req.end();
        });
    },
    // Get Tv Current Volume & mute Status
    getTvVolume: function (callback) {
        var getVolume = 0;
        this.setJsonCommandStatus("/sony/audio", "getVolumeInformation", null, function (err, json) {
            if (err == false && !json['error']) {
                var results = json['result'];
                for (var index in results) {
                    var eachResult = results[index];
                    for (var idx in eachResult) {
                        var eachObject = eachResult[idx];
                        if (eachObject['target'] === 'speaker') {
                            getVolume = eachObject['volume'];
                            this.isMute = !Boolean(eachObject['mute']);
                            this.status = getVolume;
                            this.previousPercentage = getVolume;
                            //this.log("Get Volume is :%s", this.status);
                            //this.log("Get Volume is Mute :%s", this.isMute);
                        }
                    }
                }
                //this.log("Get Volume :%s", getVolume);
                this.service.getCharacteristic(Characteristic.Brightness).updateValue(getVolume);
                callback(null, this.status);
            } else {
                var msg = "Error: " + json['error'].toString();
                //this.log("Get Volume Error :%s", msg);
                this.status = 0;
                this.isMute = 0;
                callback(msg, this.status);
            }
        }.bind(this));
    },

    // Set TV Volume
    setTvVolume: function (volume, callback) {
        if (!this.isTvOn) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
            }.bind(this));
        }

        if (this.isTvOn) {
            clearTimeout(this.timerVolume);
            this.timerVolume = setTimeout(function () {
                var newVolume = volume;
                this.volumeInProgress = true;
                if (volume < 0) {
                    newVolume = Math.min((this.previousPercentage + volume), this.maxVolume);
                }
                else if (newVolume > this.maxVolume) {
                    newVolume = Math.min(volume, this.maxVolume);
                }
                //this.log("New Volume: %s", newVolume.toString());
                this.setJsonCommandStatus("/sony/audio", "setAudioVolume", {
                    target: 'speaker',
                    volume: newVolume.toString()
                }, function (err, json) {
                    this.updateTvVolumeOrSpeaker(volume, this.previousPercentage, function (err, value) {
                        callback(err, this.status);
                    }.bind(this))
                }.bind(this));
            }.bind(this), 1000);
        } else {
            this.status = 0;
            callback(new Error("TV is not On"));
        }
    },

    // Check TV Volume Update or Audio System
    updateTvVolumeOrSpeaker: function (newVolume, oldVolume, callback) {
        var getVolume = newVolume;
        if (newVolume < 0) {
            getVolume = Math.min((oldVolume + newVolume), this.maxVolume);
        }
        else if (newVolume > this.maxVolume) {
            getVolume = Math.min(newVolume, this.maxVolume);
        }
        //this.log("newVolume: %s oldVolume: %s getVolume: %s", newVolume, oldVolume, getVolume);

        this.setJsonCommandStatus("/sony/audio", "getVolumeInformation", null, function (err, json) {
            if (err == false && !json['error']) {
                var results = json['result'];
                for (var index in results) {
                    var eachResult = results[index];
                    for (var idx in eachResult) {
                        var eachObject = eachResult[idx];
                        if (eachObject['target'] == 'speaker') {
                            //this.log("getVolume: %s --- volume: %s", getVolume, eachObject['volume']);
                            if (getVolume != eachObject['volume']) {
                                //this.log("Audio Speaker Volume Update");
                                this.status = 0;
                                this.volumeInProgress = false;
                                clearTimeout(this.timerSpeaker);
                                this.timerSpeaker = setTimeout(function () {
                                    this.service.getCharacteristic(Characteristic.Brightness).updateValue(0);
                                }.bind(this), 1000);

                                this.setAudioSystemVolume(newVolume, function (err, value) {
                                    this.status = value;
                                    callback(err, value);
                                }.bind(this));
                            } else {
                                //this.log("TV Volume Speaker Update");
                                this.status = getVolume;
                                this.volumeInProgress = false;
                                clearTimeout(this.timerSpeaker);
                                this.timerSpeaker = setTimeout(function () {
                                    this.service.getCharacteristic(Characteristic.Brightness).updateValue(getVolume);
                                }.bind(this), 1000);
                                callback(null, getVolume);
                            }
                        }
                    }
                }
            } else {
                var msg = "Error: " + json['error'].toString();
                //this.log("Get Volume Error :%s", msg)
                callback(new Error(msg));
            }
        }.bind(this));
    },

    // Set TV Volume Up or Down
    setAudioSystemVolume: function (newVolume, callback) {
        //this.log("Set Speaker Volume :%s = %s -- current volume: %s", newVolume, Math.abs(newVolume), this.status);
        var total, commands;
        if (newVolume > 0) {
            total = newVolume;
            commands = "VolumeUp";
            for (var num = 1; num < total; num++) {
                commands += " VolumeUp";
            }
            //this.log("Tv Volume Commands: %s", commands);
            this.setRemoteCommand(commands);
            callback(null, 0);
        } else {
            total = Math.abs(newVolume);
            commands = "VolumeDown";
            for (var num = 1; num < total; num++) {
                commands += " VolumeDown";
            }
            //this.log("Tv Volume Commands: %s", commands);
            this.setRemoteCommand(commands);
            callback(null, 0);
        }

    },

    // Get Tv Is On and Check if it Mute
    getTvIsMute: function (callback) {
        //this.log("Getting whether Mute Sony TV is on...");
        if (!this.isTvOn) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
                if (err == null && isOn == true) {
                    this.getTvVolume(function (err, value) {
                    });
                    callback(null, this.isMute);
                } else {
                    callback(err, isOn);
                }
            }.bind(this));
        } else {
            callback(null, this.isMute);
        }
    },

    // Set Tv Is On Mute
    setTvToMute: function (value, callback) {
        value = Boolean(value);
        if (this.isTvOn == false) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
            }.bind(this));
        }
        if (this.isTvOn) {
            if (this.volumeInProgress == false && this.isMute != value) {
                this.setRemoteCommand("Mute");
                this.isMute = value;
                callback(null, value);
            } else {
                callback();
            }
        } else {
            this.status = 0;
            callback(new Error("TV is not On"));
        }
    },

    // Get TV Status is On/Off
    getTvPowerOn: function (callback) {
        this.setJsonCommandStatus("/sony/system", "getPowerStatus", "", function (err, json) {
            if (err == false && !json['error']) {
                var status = json.result[0].status;
                var isOn = status == "active";
                this.isTvOn = isOn;
                // this.log("Get Button: %s  <--> Tv is: %s", this.name, isOn ? "on" : "off");
                callback(null, isOn); // success
            } else {
                this.status = 0;
                this.isTvOn = false;
                //this.log("Error: Unable to get TV status");
                callback(new Error("Unable to get TV status"));
            }
        }.bind(this));
    },

    // Set Tv to On
    setTvPowerOn: function (value, callback) {
        value = Boolean(value);
        if (value && this.macAddress) {
            wol.wake(this.macAddress, function (error) {
                if (error) {
                    // handle error
                    this.isTvOn = 0;
                    callback(error);
                } else {
                    // done sending packets
                    this.isTvOn = 1;
                    callback();
                }
            }.bind(this));
        } else {
            this.setJsonCommandStatus("/sony/system", "setPowerStatus", {'status': value}, function (err, json) {
                if (err == false) {
                    this.isTvOn = value;
                    callback(); // success
                } else {
                    this.isTvOn = 0;
                    callback(err || new Error("Error setting TV power state."));
                }
            }.bind(this));
        }
    },

    // Set TV Channel
    setTvChannel: function (newLevel, callback) {
        //this.log("Set Channel to %s", newLevel);
        if (this.isTvOn == false) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
            }.bind(this));
        }
        if (this.isTvOn == true) {
            var newChannel = newLevel;
            if (this.maxChannel > newLevel) {
                newChannel = Math.min(newLevel, this.maxChannel);
            }
            newChannel = newChannel.toString();
            //this.log("New Channel :%s -- length: %s", newChannel, newChannel.length);
            var channelString = "";
            for (var num = 0; num < newChannel.length; num++) {
                channelString += "Num" + newChannel.substring(num, num + 1) + " ";
            }
            //this.log("New Channel channelString :%s", channelString);
            this.status = parseInt(newChannel);
            this.setRemoteCommand(channelString);
            callback(null, this.status);
        } else {
            this.status = 0;
            callback(new Error("TV is not On"), 0);
        }
    },

    // Get Current Tv Channel
    getTvChannel: function (callback) {
        //this.log("getTvChannel");

        var getChannel = 0;
        this.setJsonCommandStatus("/sony/avContent", "getPlayingContentInfo", null, function (err, json) {
            if (err == false && !json['error']) {
                var results = json['result'];
                for (var index in results) {
                    var eachResult = results[index];
                    if (eachResult['source'].indexOf('tv') > -1) {
                        getChannel = eachResult['dispNum'];
                        this.status = getChannel;
                        this.previousPercentage = getChannel;
                        this.service.getCharacteristic(Characteristic.Brightness).setProps({
                            minStep: 1,
                            maxValue: this.maxChannel
                        }).updateValue(parseInt(getChannel));
                    }
                }
                //this.log("Get Tv Channel: %s", parseInt(getChannel));

                callback(null, parseInt(getChannel));
            } else {
                var msg = "Error: " + json['error'].toString();
                //this.log("Get Volume Error :%s", msg);
                this.status = 0;
                this.previousPercentage = 0;
                //this.log("getTvChannel: %s", msg);
                callback(new Error(msg), 0);
            }
        }.bind(this));
    },

    setChannelPower: function (value, callback) {

        //this.log("setChannelPower: %s", value);
        if (!this.isTvOn) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
                callback(null, this.isTvOn);
            }.bind(this));
        } else {
            if (this.isTvOn) {
                callback(null, this.isTvOn);
            } else {
                callback(new Error("TV Is Off "));
            }
        }
    },

    getChannelPower: function (callback) {
        //this.log("getChannelPower");
        if (!this.isTvOn) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
                if (err == null && isOn == true) {
                    this.getTvChannel(function (err, value) {
                    });
                    callback(null, isOn);
                } else {
                    callback(err, isOn);
                }
            }.bind(this));
        } else {
            callback(null, this.isTvOn);
        }
    },

    setButtonOn: function (value, callback) {
        //this.log("setButtonOn: %s", value);
        if (!this.isTvOn) {
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
                if (this.isTvOn === true) {
                    if (this.onUri && this.offUri) {
                        var uri = value > 0 ? this.onUri : this.offUri;
                        var that = this;
                        this.setJsonCommandStatus("/sony/avContent", "setPlayContent", {"uri": uri},
                            function (err, json) {
                                that.status = value;
                            }.bind(this))
                            .bind(this);
                    } else {
                        var send = value > 0 ? this.onCode : this.offCode;
                        this.setRemoteCommand(send);
                    }
                    this.status = value;
                    callback(null, value);
                } else {
                    this.status = 0;
                    callback(new Error("Button: Tv is Not On"), 0);
                }
            }.bind(this));
        } else {

            if (this.isTvOn === true) {
                var send = value > 0 ? this.onCode : this.offCode;
                this.setRemoteCommand(send);
                this.status = value;
                callback(null, value);
            } else {
                this.status = 0;
                callback(new Error("Button: Tv is Not On"), 0);
            }
        }
    },

    getButtonOn: function (callback) {
        //this.log("getButtonOn");

        if (!this.isTvOn) {
            var that = this;
            this.getTvPowerOn(function (err, isOn) {
                this.isTvOn = isOn;
                if (isOn === true) {
                    this.getIfThereIsHDMIPort(function (value) {
                        if (value > 0) {
                            that.status = 1;
                            setTimeout(function () {
                                this.service.getCharacteristic(Characteristic.On).updateValue(that.status);
                            }.bind(this), 1000);
                        }
                    }.bind(this));
                    callback(null, that.status);
                }
                else {
                    that.status = 0;
                    callback(null, that.status);
                }
            }.bind(this));
        } else {
            var that = this;
            if (this.isTvOn == true) {
                this.getIfThereIsHDMIPort(function (value) {
                    if (value == 1) {
                        that.status = 1;
                        setTimeout(function () {
                            this.service.getCharacteristic(Characteristic.On).updateValue(that.status);
                        }.bind(this), 1000);
                    }
                }.bind(this));
                callback(null, that.status);
            } else {
                that.status = 0;
                callback(new Error("Button: Tv is Not On"), 0);
            }
        }
    },

    getIfThereIsHDMIPort: function (callback) {
        var getHdmi = 0;
        this.setJsonCommandStatus("/sony/avContent", "getPlayingContentInfo", null, function (err, json) {
            if (err == false && !json['error']) {
                var results = json['result'];
                for (var index in results) {
                    var eachResult = results[index];
                    if (eachResult['source'].indexOf('hdmi') > -1) {
                        var title = this.mainName + " " + eachResult['title'];
                        if (title.toLowerCase().indexOf(this.name.toLowerCase()) > -1) {
                            getHdmi = 1;
                        }
                    }
                }
            }
            //this.log("Get HDMI: %s == %s", this.name, getHdmi);
            callback(getHdmi);
        }.bind(this));

    },

    runTimer: function () {

        this.getTvPowerOn(function (err, isOn) {
            this.isTvOn = isOn;
        }.bind(this));

        if (this.isVolume) {
            this.getTvPowerOn(function (err, isOn) {
                this.getTvIsMute(function (err, isOn) {
                    //this.log("Name: %s -- %s", this.name, isOn);
                }.bind(this));
                this.getTvVolume(function (err, volume) {
                    //this.log("Name: %s -- %s", this.name, volume);
                }.bind(this));
            }.bind(this));
        }
        else if (this.isChannel) {
            this.getTvPowerOn(function (err, isOn) {
                if (this.isTvOn == true) {
                    this.getChannelPower(function (err, isOn) {
                        //this.log("Name: %s -- %s", this.name, isOn);
                        this.service.getCharacteristic(Characteristic.On).updateValue(isOn);
                    }.bind(this));
                    this.getTvChannel(function (err, channel) {
                        //this.log("Name: %s -- %s", this.name, channel);
                    }.bind(this));

                }
            }.bind(this));
        }
        else if (this.isSwitch) {
            if (this.isTvPowerButton) {
                this.getTvPowerOn(function (err, isOn) {
                    //this.log("Name: %s -- %s", this.name, isOn);
                }.bind(this));
            } else {
                this.getButtonOn(function (err, isOn) {
                    //this.log("Name: %s -- %s", this.name, isOn);
                }.bind(this));
            }
        }
    },

    updateTimer: function () {
        if (this.polling) {
            clearTimeout(this.timerUpdate);
            this.timerUpdate = setTimeout(function () {
                this.runTimer();
                this.updateTimer();
            }.bind(this), this.interval * 1000);
        }
    }
};
