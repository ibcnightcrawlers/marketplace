'use strict'
const http = require('http')
const KEY_FILENAME = 'My First Project-c5c22af24705.json' 
const PROJECT_ID = 'famous-empire-143016' 
const fs = require('fs')
const dgram = require('dgram')
const LRU = require("lru-cache")

class JsonSerializer {
    serialize(m) {
        return Buffer.from(JSON.stringify(m))
    }

    deserialize(messageBuf) {
        return JSON.parse(messageBuf.toString())
    }
}

class Contributor {
    constructor(id, rinfo) {
        this.id = id
        this.rinfo = rinfo
    }    
}

class Producer {
    constructor(id, rinfo) {
        this.id = id
        this.rinfo = rinfo
    }    
}

class Viewer {
    constructor(id, rinfo) {
        this.id = id
        this.rinfo = rinfo
    }    
}

class Topic {
    constructor(title, coord, radius) {
        this.title = title
        this.coord = coord
        this.radius = radius
    }

    toJSON() {
        let {title, coord, radius} = this
        let type = 'topic'
        return {title, coord, radius, type}
    }
}

class Offer {
    constructor(buyer, topic, geolocation) {
        this.buyer = buyer
        this.topic = topic
        this.geolocation
    }

    get id() {
        return `${this.buyer}:${this.topic}`
    }
}

class MarketplaceServer {
    constructor(port, addr, serializer) {
        this.contributors = new LRU(100)
        this.producers = new LRU(100)
        this.viewers = new LRU(100)
        this.offers = new LRU(100)
        this.topics = new LRU(100)
        this.port = port
        this.addr = addr
        this.serializer = serializer
        var vision = this.vision = require('@google-cloud/vision')({
            projectId: PROJECT_ID,
            keyFilename: KEY_FILENAME
        });

    }

    onPing(message, rinfo) {
        //this.log('got ping from contributor', message.id)
        let contributor = this.contributors.get(message.id)
        if (!contributor) {
            this.onNewContributor(message.id, rinfo)
        }
    }

    onProducerPing(message, rinfo) {
        //this.log('got ping from producer', message.id)
        let producer = this.producers.get(message.id)
        if (!producer) {
            this.onNewProducer(message.id, rinfo)
        }
    }

    onViewerPing(message, rinfo) {
        let viewer = this.viewers.get(message.id)
        if (!viewer) {
            this.onNewViewer(message.id, rinfo)
        }
    }

    onNewContributor(id, rinfo) {
        let contributor = new Contributor(id, rinfo)
        this.contributors.set(id, contributor)
        this.topics.values()
            .filter((topic) =>{
                return true    
            })
            .forEach((topic) =>{
                this.send(topic, contributor)
            })
    }

    onNewProducer(id, rinfo) {
        this.log('got new producer', id)
        let producer = new Producer(id, rinfo)
        this.producers.set(id, producer)
        
        // this.topics.values()
        //     .filter((topic) =>{
        //         return true    
        //     })
        //     .forEach((topic) =>{
        //         this.send(topic, contributor)
        //     })
    }

    onNewViewer(id, rinfo) {
        this.log('got new viewer', id)
        let viewer = new Viewer(id, rinfo)
        this.viewers.set(id, viewer)
        // this.topics.values()
        //     .filter((topic) =>{
        //         return true    
        //     })
        //     .forEach((topic) =>{
        //         this.send(topic, contributor)
        //     })
    }

    onImage(image) {
        let imageData = image.image
        let id = image.id
        let imageName = 'image.png'
        let buffer = Buffer.from(imageData, 'base64');
        fs.writeFileSync(imageName, buffer)
        // this.analyze(imageName, (err, result) => {
        //     if (err) {
        //         console.log(err.stack)
        //         return
        //     }
        //     this.publishStreamMetadataResult(id, result)
        // })
    }

    analyze(imageName, id) {
        this.vision.detectFaces(imageName, (err, faces)=> {
            let hasFace = faces.some((face) => {
                return face.confidence > 60
            })            
            this.publishStreamMetadataResult(id, {
                face: hasFace
            })
        })

        this.vision.detectSafeSearch(imageName, (err, result)=> {
            this.publishStreamMetadataResult(id, result)
        })
    }

    publishTopic(title, coord, radius) {
        let topic = new Topic(title, coord, radius)
        this.topics.set(title, topic)
        for(let c of this.contributors.values()) {
            this.log('sending topic to contributor ' + c.id)
            this.send(topic, c)
        }
    }

    publishStreamMetadataResult(id, result) {
        //console.log('stream metadata result', JSON.stringify(result))
        for(let producer of this.producers.values()) {
            result.type = 'stream-metadata'
            this.send(result, producer)
        }
    }

    offer(o, id) {
        console.log('send offer to', id)
        o.type = 'offer'
        this.offers.set(o.id, o, o.maxAge)
        let contributor = this.contributors.get(id)
        if (!contributor) {
            console.log('invalid offer target', id)
            return
        }
        this.send(o, contributor)
    }

    send(message, receiver) {
        const m = this.serializer.serialize(message)
        let {port, address} = receiver.rinfo
        this.log('sending', m.toString(), address, port)
        this.socket.send(m, port, address, (err) => {
            //this.socket.close();
        });
    }

    onMessage(buf, rinfo) {
        let message = this.serializer.deserialize(buf)
        this.dispatch(message, rinfo)
    }

    log(...args) {
        args.unshift('server')
        console.log.apply(console, args)
    }

    onError(err) {
        this.log(`server error:\n${err.stack}`);
        this.socket.close();
    }

    onTopicAccept(topicAccept, rinfo) {
        let contributor = this.contributors.values().filter(function (c) {
            return c.rinfo.address == rinfo.address
        }).pop()

        console.log('contributor', rinfo.address, contributor)
        this.log('Got topic-accept', topicAccept)

        this.publishTopicAccept(topicAccept)

        // setTimeout(()=> {
        //     this.offer({
        //         buyer: 'foxy-news',
        //         topic: topicAccept.topic,
        //         amount: 100,
        //         currency: 'USD'
        //     }, topicAccept.id)
        // })
    }

    publishTopicAccept(topicAccept) {
        for(let producer of this.producers.values()) {
            this.send(topicAccept, producer)
        }
    }

    onOffer(offer) {
        this.offer(offer, offer.id)
    }

    onStop(stop) {
        let contributor = this.contributors.values().filter((c)=> {
            return c.id == stop.id
        }).pop()
        if (!contributor) {
            console.log('Invalid target to stop: ' + JSON.stringify(stop))
        }
        this.send(stop, contributor)
    }

    onTopic(topic) {
        this.publishTopic(topic.title || 'title-placeholder')
    }

    onOfferAccept(offerAccept, rinfo) {
        this.log('Got offer accept', offerAccept)
        // for(let v of this.viewers.values()) {
        //     this.send({
        //         type: 'channel_change',
        //         channel: offerAccept.id
        //     }, v)
        // }
        let channelChange = {
            type: 'channel_change',
            channel: offerAccept.id
        }

        this.publishToViewers(channelChange)
    }

    onChannelChange(channelChange) {
        this.publishToViewers(channelChange)
    }

    publishToViewers(message) {
        for(let v of this.viewers.values()) {
            this.send(message, v)
        }
    }

    onListening() {
        var address = this.socket.address();
        this.log(`listening ${address.address}:${address.port}`);
    }

    listen() {
        this.socket = dgram.createSocket({type: 'udp4', reuseAddr: true})
        this.socket.on('message', this.onMessage.bind(this))
        this.socket.on('error', this.onError.bind(this))
        this.socket.on('listening', this.onListening.bind(this))
        this.socket.bind(this.port, this.addr)

        this.httpServer = http.createServer(this.onHttpRequest.bind(this))
        this.httpServer.listen(8080, this.addr)
    }

    onHttpRequest(req, res) {
        //this.log('http request')
        switch(req.url) {
            case '/image':
                //this.log('image request')
                this.bufferedRequest(req, (req, body)=> {
                    let imageMessage = JSON.parse(body)
                    res.writeHead(200, {'content-length': 0})
                    res.end()
                    this.onImage(imageMessage)
                })
            break;
            default:
                this.log('Unknown http resource ' + req.url)
            break;    
        }
    }

    bufferedRequest(req, callback) {
        let d = ''
        req.on('data', function (data) {
            //console.log('data: ', data.toString())
            d += data
        })
        req.on('end', function () {
            callback(req, d)
        })
    }

    dispatch(message, rinfo) {
        switch(message.type) {
            case 'image':
                this.onImage(message)
                break;
            case 'ping':
                this.onPing(message, rinfo)
                break
            case 'producer-ping':
                this.onProducerPing(message, rinfo)
                break
            case 'offer':
                this.onOffer(message, rinfo)
                break
            case 'topic':
                this.onTopic(message, rinfo)
                break
            case 'viewer-ping':
                this.onViewerPing(message, rinfo)
                break
            case 'offer-accept':
                this.onOfferAccept(message, rinfo)
                break;
            case 'topic-accept':
                this.onTopicAccept(message, rinfo)
                break;
            case 'channel_change':
                this.onChannelChange(message, rinfo)
                break;
            case 'stop':
                this.onStop(message, rinfo)
            break;
            default:
                this.log('Unknown message', message)
        }
    }
}

class ProducerClient {
    constructor(id, serverPort, serverAddr, serializer) {
        this.id = id
        this.serverPort = serverPort
        this.serverAddr = serverAddr
        this.serializer = serializer
        this.socket = dgram.createSocket('udp4')
        this.socket.on('message', this.onMessage.bind(this))   
    }

    onMessage(buf, rinfo) {
        let message = this.serializer.deserialize(buf)
        this.dispatch(message, rinfo)
    }

    dispatch(message) {
        switch(message.type) {
            case 'contributor':
                this.onContributor(message)
            break
            default:
            this.log('Unknown message', message.type)
        }
    }

    log(...args) {
        args.unshift('contributor ' + this.id)
        console.log.apply(console, args)
    }

    join() {
        this.pingInterval = setInterval(this.ping.bind(this), 500)    
    }

    ping() {
        this.send({
            type: 'producer-ping',
            id: this.id
        })
    }

    topic(title) {
        this.send({
            type: 'topic',
            id: this.id,
            title
        })
    }

    offer() {
        this.send()
    }

    send(message) {
        const m = this.serializer.serialize(message)
        
        this.socket.send(m, this.serverPort, this.serverAddr, (err) => {
            //this.socket.close();
        });
    }

    onContributor(contributor) {
        
    }
}

class ContributorClient {
    constructor(id, serverPort, serverAddr, serializer) {
        this.id = id
        this.serverPort = serverPort
        this.serverAddr = serverAddr
        this.serializer = serializer
        this.socket = dgram.createSocket('udp4')
        this.socket.on('message', this.onMessage.bind(this))
    }

    onMessage(buf, rinfo) {
        let message = this.serializer.deserialize(buf)
        this.dispatch(message, rinfo)
    }

    dispatch(message) {
        switch(message.type) {
            case 'offer':
                this.onOffer(message)
            break
            case 'topic':
                this.onTopic(message)
            break
            case 'topic-accept':
                this.onTopicAccept(message)
            default:
            this.log('Unknown message', message.type)
        }
    }

    log(...args) {
        args.unshift('contributor ' + this.id)
        console.log.apply(console, args)
    }

    onOffer(offer) {
        this.log('got offer', JSON.stringify(offer))
    }

    onTopic(topic) {
        // this.log('got topic', topic)
        // setTimeout(()=> {
        //     this.log('accepts topic', topic.title)
        //     this.send({
        //         type: 'topic-accept',
        //         topic: topic.title,
        //         contributor: this.id
        //     })
        // }, 1000)
    }

    join() {
        this.pingInterval = setInterval(this.ping.bind(this), 500)    
    }

    ping() {
        this.send({
            type: 'ping',
            id: this.id
        })        
    }

    send(message) {
        const m = this.serializer.serialize(message)
        
        this.socket.send(m, this.serverPort, this.serverAddr, (err) => {
            //this.socket.close();
        });
    }
}

// class ViewerClient {
//     constructor(id, serverPort, serverAddr, serializer) {
//         this.id = id
//         this.serverPort = serverPort
//         this.serverAddr = serverAddr
//         this.serializer = serializer
//         this.socket = dgram.createSocket('udp4')
//         this.socket.on('message', this.onMessage.bind(this))
//     }

//     onMessage(buf, rinfo) {
//         let message = this.serializer.deserialize(buf)
//         this.dispatch(message, rinfo)
//     }

//     dispatch(message) {
//         switch(message.type) {
//             case 'topic-accept':
//                 this.onTopicAccept(message)
//             default:
//             this.log('Unknown message', message.type)
//         }
//     }

//     log(...args) {
//         args.unshift('contributor ' + this.id)
//         console.log.apply(console, args)
//     }
// }

const SERVER_PORT = 41234
const SERVER_ADDR = '192.168.43.224' //  '10.40.13.14' 

let serializer = new JsonSerializer()

let server = new MarketplaceServer(SERVER_PORT, SERVER_ADDR, serializer)
server.listen()

//server.onNewViewer('1', {address: '', port: ''})

// process.stdin.on('data', function (data) {
//     let cmd = data.toString()

//     let parts = cmd.split(' ')
//     let cmdType = parts.shift()
//     switch(cmdType) {
//         case 'offer':
//         let contributorId = parts.shift()
//         let buyer = parts.shift()
//         let amount = parts.shift().replace(/\n/, '')
//         server.offer({
//             buyer: buyer,
//             amount: amount,
//             id: contributorId
//         }, contributorId)
//         break;
//         case 'topic':
//         let title = parts.shift().replace(/\n/, '')
//         server.publishTopic(title)
//         break;
//         case 'contribs':
//         console.log('got contribs')
//         console.log(server.contributors.values())
//         break;
//         case 'clients':
//         console.log(server.clients.values())
//         break;
//     }
// })

// let contributor1 = new ContributorClient('1', SERVER_PORT, SERVER_ADDR, serializer)
// contributor1.join()

// let contributor2 = new ContributorClient('2', SERVER_PORT, SERVER_ADDR, serializer)
// let producer1 = new ProducerClient('foxy-news', SERVER_PORT, SERVER_ADDR, serializer)
// producer1.join()

// producer1.topic('test-topic')
// setTimeout(function () {
//     producer1.join()
//     setTimeout(function () {
//         producer1.topic({
//             title: 'IBC'
//         })
//     }, 2000)
// }, 2000)

// setTimeout(function () {
//     contributor2.join()
//     //contributor2.offerAccept
// }, 4000)

// let viewer = new Viewer('1', SERVER_PORT, SERVER_ADDR, serializer)
// setTimeout(function () {
//     viewer.join()
// }, 2000)


// setTimeout(function () {
//     server.offer({
//         buyer: 'foxy-news',
//         amount: 100,
//         currency: 'USD'
//     })
// }, 2000)

//contributor1.join()
// server.on('message', (msg, rinfo) => {
//   console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
//   let message = parseMsg(msg)
  
// });



// server listening 0.0.0.0:41234