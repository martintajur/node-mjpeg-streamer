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
    width=352;
}

if (typeof height == 'undefined' || height === null) {
    width=288;
}

var server = http.createServer(function(req, res) {
    //console.log(req.url);
    if (req.url === "/") {
        res.writeHead(200, {
            "content-type": "text/html;charset=utf-8",
        });
        res.end(["<!doctype html>", "<html><head><meta charset='utf-8'/>", "</head><body>", "<img src='test.jpg' id='cam'  />", "</body></html>", ].join(""));
        return;
    }
    if (req.url.match(/^\/.+\.(mjpeg|mjpg|jpg|jpeg|mpjpeg)$/)) {
        console.log("requested " + req.url)
        var boundary = "BOUNDARY"
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace;boundary="' + boundary + '"',
            'Connection': 'keep-alive',
            'Expires': 'Fri, 01 Jan 1990 00:00:00 GMT',
            'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            'Pragma': 'no-cache'
        });

  
        var subscriber_token = PubSub.subscribe('MJPEG', function(msg, data) {
            //console.log( msg, data );
            //jpeg.encodeSync().pipe(writer)
            // console.log("Buffer(jpeg_image_data).length: "+Buffer(jpeg_image_data).length);
            res.write('--' + boundary + '\r\n')
            res.write('Content-Type: image/jpeg\r\n');
            res.write('Content-Length: ' + data.length + '\r\n');
            res.write("\r\n");
            res.write(Buffer(data), 'binary');
            res.write("\r\n");

        });
        res.on('close', function() {

            console.log("Connection closed!");
            PubSub.unsubscribe(subscriber_token);
            res.end();

        });

        //var png = toPng();
        //res.end(png, 'binary');
        //console.log("Sent data"+png.length);
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

try {
    var cam = new v4l2camera.Camera("/dev/video" + device);
} catch (err) {
    console.log("v4l2camera error");
    process.exit(1);
}

console.log("Opened camera device /dev/video" + device);

cam.formats.forEach(function(fmt) {
    console.log(fmt.formatName + ", " + fmt.width + "x" + fmt.height);
});

cam.configSet({
    width: width,
    height: height
});

cam.start();
console.log("Capture started " + new Date().toISOString());

cam.capture(function loop(success) {
  if (!success) {
    console.log("Capture failed at " + new Date().toISOString());
  }
  PubSub.publish('MJPEG', cam.frameRaw());
  process.nextTick(cam.capture.bind(this, loop));
});
