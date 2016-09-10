'use strict'

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
        this.clients = new LRU(100)
        this.offers = new LRU(100)
        this.topics = new LRU(100)
        this.port = port
        this.addr = addr
        this.serializer = serializer
    }

    onPing(message, rinfo) {
        this.log('got ping from contributor', message.id)
        let contributor = this.contributors.get(message.id)
        if (!contributor) {
            this.onNewContributor(message.id, rinfo)
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

    publishTopic(title, coord, radius) {
        let topic = new Topic(title, coord, radius)
        this.topics.set(title, topic)
        for(let c of this.contributors.values()) {
            this.send(topic, c)
        }
    }

    offer(o, id) {
        o.type = 'offer'
        this.offers.set(o.id, o, o.maxAge)
        let contributor = this.contributors.get(id)
        this.send(o, contributor)
    }

    send(message, contributor) {
        const m = this.serializer.serialize(message)
        let {port, address} = contributor.rinfo
        this.log('sending', m.toString())
        this.socket.send(m, port, address, (err) => {
            //this.socket.close();
        });
    }

    onMessage(buf, rinfo) {
        console.log('MESSAGE', buf.toString())
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
        setTimeout(()=> {
            this.offer({
                buyer: 'foxy-news',
                topic: topicAccept.topic,
                amount: 100,
                currency: 'USD'
            }, topicAccept.id)
        })
    }

    onOfferAccept(offerAccept, rinfo) {
        this.log('Got offer accept', offerAccept)
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
        this.socket.bind(this.port, this.addr);
    }

    dispatch(message, rinfo) {
        switch(message.type) {
            case 'ping':
                this.onPing(message, rinfo)
                break
            case 'offer-accept':
                this.onOfferAccept(message, rinfo)
                break;
            case 'topic-accept':
                this.onTopicAccept(message, rinfo)
                break;
            default:
            this.log('Unknown message', message)
        }
    }
}


let counter = 0

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

    onOffer(offer) {
        this.log('got offer', JSON.stringify(offer))
    }

    onTopic(topic) {
        this.log('got topic', topic)
        counter++

        setTimeout(()=> {
            this.log('accepts topic', topic.title)
            this.send({
                type: 'topic-accept',
                topic: topic.title,
                contributor: this.id
            })
        }, 1000)
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

const SERVER_PORT = 41234
const SERVER_ADDR = '192.168.43.224' //  '10.40.13.14' 

let serializer = new JsonSerializer()

let server = new MarketplaceServer(SERVER_PORT, SERVER_ADDR, serializer)
server.listen()

process.stdin.on('data', function (data) {
    let cmd = data.toString()

    let parts = cmd.split(' ')
    let cmdType = parts.shift()
    switch(cmdType) {
        case 'offer':
        let contributorId = parts.shift()
        let buyer = parts.shift()
        let amount = parts.shift().replace(/\n/, '')
        server.offer({
            buyer: buyer,
            amount: amount
        }, contributorId)
        break;
        case 'topic':
        let title = parts.shift().replace(/\n/, '')
        server.publishTopic(title)
        break;
        case 'contribs':
        console.log('got contribs')
        console.log(server.contributors.values())
        break;
        case 'clients':
        console.log(server.clients.values())
        break;
    }
})

// let contributor1 = new ContributorClient('1', SERVER_PORT, SERVER_ADDR, serializer)
// contributor1.join()


// let contributor2 = new ContributorClient('2', SERVER_PORT, SERVER_ADDR, serializer)

// setTimeout(function () {
//     contributor2.join()
// }, 4000)

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