#!/usr/bin/env node

var http = require("http");
var PubSub = require("pubsub-js");
var util = require("util");
var v4l2camera = require("v4l2camera");
var Jpeg = require('libjpeg').Jpeg;
var Getopt = require('node-getopt');

var bundle = require('./package.json');
var version = bundle.version;
var appname = bundle.name;
var appdescr = bundle.description;

var default_port = 8080;
var default_device = 0;

var lastFrame = Buffer.from([]);

getopt = new Getopt([
        ['p', 'port=ARG', 'Port'],
        ['w', 'width=ARG', 'Width'],
        ['l', 'height=ARG', 'Height'],
        ['d', 'device=ARG', 'V4L2 Device number. 0 for "/dev/video0"'],
        ['h', 'help', 'display this help'],
        ['v', 'version', 'show version']
    ]) // create Getopt instance
    .bindHelp(); // bind option 'help' to default action


opt = getopt.parse(process.argv.slice(2));

getopt.setHelp(
    "Usage: " + appname + " [OPTION]\n" +
    "\n" +
    "[[OPTIONS]]\n" +
    "\n"
);



if (opt.options.version) {
    console.log(appname + " " + version);
    process.exit(0);
}
var port = opt.options.port;
var device = opt.options.device;
var width = opt.options.width;
var height = opt.options.height;
if (typeof port == 'undefined' || port === null) {
    console.error("Port argument missing. Assuming default port "+default_port);
    port = default_port;
}
if (typeof device == 'undefined' || device === null) {   
    console.error("Device argument missing. Assuming default device "+default_device);
    device = default_device;
}

if (typeof width == 'undefined' || width === null) {
    width=640;
}

if (typeof height == 'undefined' || height === null) {
    height=480;
}

setInterval(function() {
    PubSub.publish('MJPEG', lastFrame);
}, 1000 / 15);

var server = http.createServer(function(req, res) {
    //console.log(req.url);
    if (req.url === "/") {
        res.writeHead(200, {
            "content-type": "text/html;charset=utf-8",
        });
        res.end(["<!doctype html>", "<html><head><meta charset='utf-8'/>", "</head><body>", "<img src='/cam.jpg' id='cam' />", "</body></html>", ].join(""));
        return;
    }
    if (req.url.match(/^\/.+\.(jpg|mjpg|mjpeg|mpjpeg|mpjpg)$/)) {
        console.log("requested " + req.url);
        var boundary = "BOUNDARY";
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace;boundary="' + boundary + '"',
            'Connection': 'keep-alive',
            'Expires': 'Fri, 01 Jan 1990 00:00:00 GMT',
            'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            'Pragma': 'no-cache'
        });

        var subscriber_token = PubSub.subscribe('MJPEG', function(msg, data) {
            res.write('--' + boundary + '\r\n');
            res.write('Content-Type: image/jpeg\r\n');
            res.write('Content-Length: ' + data.length + '\r\n');
            res.write("\r\n");
            res.write(data, 'binary');
            res.write("\r\n");

        });
        res.on('close', function() {

            console.log("Connection closed!");
            PubSub.unsubscribe(subscriber_token);
            res.end();

        });

    } else {
        res.end();
    }
});

server.on('error', function(e) {
    if (e.code == 'EADDRINUSE') {
        console.log('Address in use');
    } else if (e.code == "EACCES") {
        console.log("Illegal port");
    } else {
        console.log("Unknown error");
    }
    process.exit(1);

});

server.listen(port);
console.log("Started listening at port " + port);
console.log("Using v4l2 device /dev/video" + device);

var retryCount = 0;
var attachCameraAndStart = function() {
    var cam = null;

    try {
        cam = new v4l2camera.Camera("/dev/video" + device);
    } catch (err) {
        console.log('Cannot start camera — ' + err.toString() + ' - retrying in 5...');
        retryCount++;
        if (retryCount === 5) {
            device = parseInt(device, 10) + 1;
        }
        if (retryCount === 10) {
            device = parseInt(device, 10) - 1;
        }
        setTimeout(attachCameraAndStart, 5000);
        return;
    }

    console.log("Opened camera device /dev/video" + device);

    var fmts = [],
        chosenFmt = {
            format: cam.configGet().format,
            formatName: cam.configGet().formatName,
            width: parseInt(width, 10),
            height: parseInt(height, 10),
            interval: cam.configGet().interval
        },
        fmtChosen = false;

    cam.formats.forEach(function(fmt, key) {
        if (fmt.formatName !== 'MJPG') {
            return;
        }
        fmts.push(fmt.formatName + "@" + fmt.width + "x" + fmt.height + "(" + fmt.interval.numerator + "/" + fmt.interval.denominator + ")");

        if (fmt.width === parseInt(width, 10) && fmt.height === parseInt(height, 10)) {
            chosenFmt = {
                format: fmt.format,
                formatName: fmt.formatName,
                width: parseInt(width, 10),
                height: parseInt(height, 10),
                interval: fmt.interval
            };
            fmtChosen = true;
        }
    });
    console.log(fmts.join(', '));

    try {
        cam.configSet(chosenFmt);
    } catch (err) {
        setTimeout(function() {
            attachCameraAndStart();
        }, 2000);
        return;
    }

    console.log("Format chosen:" + JSON.stringify(chosenFmt));

    cam.start();
    console.log("Capture started " + new Date().toISOString());

    var previousFrame = null;
    var publishFrameInterval = setInterval(function() {
        lastFrame = new Buffer(cam.frameRaw());
        if (previousFrame !== null && Buffer.compare(lastFrame, previousFrame) === 0) {
            console.log('Capture stopped - camera likely disconnected ' + lastFrame.length + ' vs ' + previousFrame.length);
            clearInterval(publishFrameInterval);
            setTimeout(function() {
                attachCameraAndStart();
            }, 2000);
        }
        previousFrame = Buffer.from(lastFrame);
    }, 1000 / 15);

    cam.capture(function loop(success) {
        cam.capture(loop);
    });
};

attachCameraAndStart();