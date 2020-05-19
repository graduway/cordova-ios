/*
       Licensed to the Apache Software Foundation (ASF) under one
       or more contributor license agreements.  See the NOTICE file
       distributed with this work for additional information
       regarding copyright ownership.  The ASF licenses this file
       to you under the Apache License, Version 2.0 (the
       "License"); you may not use this file except in compliance
       with the License.  You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

       Unless required by applicable law or agreed to in writing,
       software distributed under the License is distributed on an
       "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
       KIND, either express or implied.  See the License for the
       specific language governing permissions and limitations
       under the License.
*/

'use strict';

const Q = require('q');
const shell = require('shelljs');
const versions = require('./versions');

const SUPPORTED_OS_PLATFORMS = [ 'darwin' ];

const XCODEBUILD_MIN_VERSION = '9.0.0';
const XCODEBUILD_NOT_FOUND_MESSAGE =
    'Please install version ' + XCODEBUILD_MIN_VERSION + ' or greater from App Store';

const IOS_DEPLOY_MIN_VERSION = '1.9.2';
const IOS_DEPLOY_NOT_FOUND_MESSAGE =
    'Please download, build and install version ' + IOS_DEPLOY_MIN_VERSION + ' or greater' +
    ' from https://github.com/ios-control/ios-deploy into your path, or do \'npm install -g ios-deploy\'';

const COCOAPODS_MIN_VERSION = '1.8.0';
const COCOAPODS_NOT_FOUND_MESSAGE = `Please install version ${COCOAPODS_MIN_VERSION} or greater from https://cocoapods.org/`;

/**
 * Checks if xcode util is available
 * @return {Promise} Returns a promise either resolved with xcode version or rejected
 */
module.exports.run = module.exports.check_xcodebuild = function () {
    return checkTool('xcodebuild', XCODEBUILD_MIN_VERSION, XCODEBUILD_NOT_FOUND_MESSAGE);
};

/**
 * Checks if ios-deploy util is available
 * @return {Promise} Returns a promise either resolved with ios-deploy version or rejected
 */
module.exports.check_ios_deploy = function () {
    return checkTool('ios-deploy', IOS_DEPLOY_MIN_VERSION, IOS_DEPLOY_NOT_FOUND_MESSAGE);
};

module.exports.check_os = function () {
    // Build iOS apps available for OSX platform only, so we reject on others platforms
    return os_platform_is_supported() ?
        Q.resolve(process.platform) :
        Q.reject('Cordova tooling for iOS requires Apple macOS');
};

function os_platform_is_supported () {
    return (SUPPORTED_OS_PLATFORMS.indexOf(process.platform) !== -1);
}

/**
 * Checks if cocoapods repo size is what is expected
 * @return {Promise} Returns a promise either resolved or rejected
 */
module.exports.check_cocoapods = toolChecker => {
    return checkTool('pod', COCOAPODS_MIN_VERSION, COCOAPODS_NOT_FOUND_MESSAGE, 'CocoaPods');
};

/**
 * Checks if specific tool is available.
 * @param  {String} tool       Tool name to check. Known tools are 'xcodebuild' and 'ios-deploy'
 * @param  {Number} minVersion Min allowed tool version.
 * @param  {String} message    Message that will be used to reject promise.
 * @param  {String} toolFriendlyName  Friendly name of the tool, to report to the user. Optional.
 * @return {Promise}           Returns a promise either resolved with tool version or rejected
 */
function checkTool (tool, minVersion, message, toolFriendlyName) {
    toolFriendlyName = toolFriendlyName || tool;

    // Check whether tool command is available at all
    let tool_command = shell.which(tool);
    if (!tool_command) {
        return Q.reject(toolFriendlyName + ' was not found. ' + (message || ''));
    }

    // check if tool version is greater than specified one
    return versions.get_tool_version(tool).then(function (version) {
        version = version.trim();
        return versions.compareVersions(version, minVersion) >= 0 ?
            Q.resolve({ 'version': version }) :
            Q.reject('Cordova needs ' + toolFriendlyName + ' version ' + minVersion +
              ' or greater, you have version ' + version + '. ' + (message || ''));
    });
}

/**
 * Object that represents one of requirements for current platform.
 * @param {String}  id        The unique identifier for this requirements.
 * @param {String}  name      The name of requirements. Human-readable field.
 * @param {Boolean} isFatal   Marks the requirement as fatal. If such requirement will fail
 *                            next requirements' checks will be skipped.
 */
let Requirement = function (id, name, isFatal) {
    this.id = id;
    this.name = name;
    this.installed = false;
    this.metadata = {};
    this.isFatal = isFatal || false;
};

/**
 * Methods that runs all checks one by one and returns a result of checks
 * as an array of Requirement objects. This method intended to be used by cordova-lib check_reqs method
 *
 * @return Promise<Requirement[]> Array of requirements. Due to implementation, promise is always fulfilled.
 */
module.exports.check_all = function () {

    const requirements = [
        new Requirement('os', 'Apple macOS', true),
        new Requirement('xcode', 'Xcode'),
        new Requirement('ios-deploy', 'ios-deploy'),
        new Requirement('CocoaPods', 'CocoaPods')
    ];

    let result = [];
    let fatalIsHit = false;

    let checkFns = [
        module.exports.check_os,
        module.exports.check_xcodebuild,
        module.exports.check_ios_deploy,
        module.exports.check_cocoapods
    ];

    // Then execute requirement checks one-by-one
    return checkFns.reduce(function (promise, checkFn, idx) {
        return promise.then(function () {
            // If fatal requirement is failed,
            // we don't need to check others
            if (fatalIsHit) return Q();

            let requirement = requirements[idx];
            return checkFn()
                .then(function (version) {
                    requirement.installed = true;
                    requirement.metadata.version = version;
                    result.push(requirement);
                }, function (err) {
                    if (requirement.isFatal) fatalIsHit = true;
                    requirement.metadata.reason = err;
                    result.push(requirement);
                });
        });
    }, Q())
        .then(function () {
            // When chain is completed, return requirements array to upstream API
            return result;
        });
};
