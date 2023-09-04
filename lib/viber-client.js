"use strict";

const _ = require('underscore');
const util = require('util');
const got = require('got');
const { HttpProxyAgent, HttpsProxyAgent } = require('hpagent');

const pjson = require(__dirname + '/../package.json');

const VIBER_AUTH_TOKEN_HEADER = "X-Viber-Auth-Token";
const MAX_GET_ONLINE_IDS = 100;
const API_ENDPOINTS = {
	"setWebhook": "/set_webhook",
	"getAccountInfo": "/get_account_info",
	"getUserDetails": "/get_user_details",
	"getOnlineStatus": "/get_online",
	"sendMessage": "/send_message",
	"post": "/post"
};

function ViberClient(logger, bot, apiUrl, subscribedEvents) {
	this._logger = logger;
	this._bot = bot;
	this._url = apiUrl;
	this._subscribedEvents = subscribedEvents;
	this._userAgent = util.format("ViberBot-Node/%s", pjson.version);
}

ViberClient.prototype.setWebhook = function(url, isInline) {
	this._logger.info("Sending 'setWebhook' request for url: %s, isInline: %s", url, isInline);
	return this._sendRequest("setWebhook", {
		"url": url,
		"is_inline": isInline,
		"event_types": this._subscribedEvents
	});
};

ViberClient.prototype.sendMessage = function(optionalReceiver, messageType, messageData, optionalTrackingData, optionalKeyboard, optionalChatId, optionalMinApiVersion) {
	if (!optionalReceiver && !optionalChatId) {
		return Promise.reject(new Error(`Invalid arguments passed to sendMessage. 'optionalReceiver' and 'chatId' are Missing.`));
	}

	if (messageType && !messageData) {
		return Promise.reject(new Error(`Invalid arguments passed to sendMessage. 'MessageData' is Missing.`));
	}

	if (!messageType && !messageData && !optionalKeyboard) {
		return Promise.reject(new Error(`Invalid arguments passed to sendMessage. 'MessageData','messageType' are Missing and there's no keyboard.`));
	}

	const request = {
		"sender": {
			"name": this._bot.name,
			"avatar": this._bot.avatar
		},
		"tracking_data": this._serializeTrackingData(optionalTrackingData),
		"keyboard": optionalKeyboard,
		"chat_id": optionalChatId,
		"min_api_version": optionalMinApiVersion
	};

	if (optionalReceiver) {
		request["receiver"] = optionalReceiver;
	}

	this._logger.debug("Sending %s message to viber user '%s' with data", messageType, optionalReceiver, messageData);
	return this._sendRequest("sendMessage", Object.assign(request, messageData));
};

ViberClient.prototype.getAccountInfo = function() {
	return this._sendRequest("getAccountInfo", {});
};

ViberClient.prototype.getUserDetails = function(viberUserId) {
	if (!viberUserId) throw new Error(`Missing user id`);
	return this._sendRequest("getUserDetails", { "id": viberUserId });
};

ViberClient.prototype.getOnlineStatus = function(viberUserIds) {
	viberUserIds = _.isArray(viberUserIds) ? viberUserIds : [viberUserIds];

	if (_.isEmpty(viberUserIds)) throw new Error(`Empty or no user ids passed to getOnlineStatus`);
	if (_.size(viberUserIds) > MAX_GET_ONLINE_IDS) {
		throw new Error(`Can only check up to ${MAX_GET_ONLINE_IDS} ids per request`);
	}

	return this._sendRequest("getOnlineStatus", { "ids": viberUserIds });
};

ViberClient.prototype.postToPublicChat = function(senderProfile, messageType, messageData, optionalMinApiVersion) {
	if (!senderProfile) {
		return Promise.reject(new Error(`Invalid arguments passed to postToPublicChat. 'senderProfile' is Missing.`));
	}

	if (!messageType || !messageData) {
		return Promise.reject(new Error(`Invalid arguments passed to postToPublicChat. 'MessageData' or 'messageType' are Missing.`));
	}

	const request = {
		"from": senderProfile.id,
		"sender": {
			"name": senderProfile.name,
			"avatar": senderProfile.avatar
		},
		"min_api_version": optionalMinApiVersion
	};

	this._logger.debug("Sending %s message to public chat as viber user '%s' with data", messageType, senderProfile.id, messageData);
	return this._sendRequest("post", Object.assign(request, messageData));
};

ViberClient.prototype._sendRequest = function(endpoint, data) {
	if (!_.has(API_ENDPOINTS, endpoint)) {
		return Promise.reject(new Error(`could not find endpoint ${endpoint}`));
	}

	const url = util.format("%s%s", this._url, API_ENDPOINTS[endpoint]);
	const dataWithAuthToken = Object.assign({ "auth_token": this._bot.authToken }, data);

	const options = {
		url,
		json: dataWithAuthToken, 
		responseType: 'json',
		headers: {
			[VIBER_AUTH_TOKEN_HEADER]: this._bot.authToken,
			'User-Agent': this._userAgent // eslint-disable-line
		}
	};

	const proxyEnv = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
	const noProxyEnv = process.env.NO_PROXY ? process.env.NO_PROXY.split(",") : '';

	let noProxy = false;
	if (noProxyEnv) {
		for (let i = 0; i < noProxyEnv.length; i += 1) {
			if (url.indexOf(noProxyEnv[i]) !== -1) { 
				noProxy = true; 
			}
		}
	}
	if (proxyEnv && !noProxy) {
		const proxyURL = new URL(proxyEnv);
		const proxyAgentOptions = {
			proxy: {
				protocol: proxyURL.protocol,
				hostname: proxyURL.hostname,
				port: proxyURL.port,
				username: null,
				password: null
			},
			maxFreeSockets: 256,
			maxSockets: 256,
			keepAlive: true
		};
		options.agent = {
			http: new HttpProxyAgent(proxyAgentOptions),
			https: new HttpsProxyAgent(proxyAgentOptions)
		};
	}

	this._logger.debug("Opening request to url: '%s' with data", url, data);
	return new Promise((resolve, reject) => {
		got.post(options).then(({ statusCode, body }) => {
			if (statusCode !== 200) {
				return reject(new Error('Response error'));
			}
			this._logger.debug("Response data", body);
			resolve(body);
		}).catch(e => {
			this._logger.error("Request ended with an error", e);
			reject(e);
		});
	});
};

ViberClient.prototype._serializeTrackingData = function(optionalTrackingData) {
	if (optionalTrackingData == null || _.isEmpty(optionalTrackingData)) {
		// because of bug in production, we cannot send null, but we can send an empty string
		optionalTrackingData = "";
	}
	return JSON.stringify(optionalTrackingData);
};

module.exports = ViberClient;
