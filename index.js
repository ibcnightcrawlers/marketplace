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
    constructor(contributorPort, serializer) {
        this.contributors = new LRU(100)
        this.offers = new LRU(100)
        this.clients = []
        this.contributorPort = contributorPort
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
        this.offers.values()
            .filter((offer) =>{
                return true    
            })
            .forEach((offer) =>{
                this.send(offer, contributor)
            })
    }

    offer(o) {
        o.type = 'offer'
        this.offers.set(o.id, o, o.maxAge)
        for(let c of this.contributors.values()) {
            this.send(o, c)
        }
    }

    send(message, contributor) {
        const m = this.serializer.serialize(message)
        let {port, address} = contributor.rinfo
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

    onError() {
        this.log(`server error:\n${err.stack}`);
        server.close();
    }

    onListening() {
        var address = this.socket.address();
        this.log(`listening ${address.address}:${address.port}`);
    }

    listen() {
        this.socket = dgram.createSocket('udp4')
        this.socket.on('message', this.onMessage.bind(this))
        this.socket.on('error', this.onError.bind(this))
        this.socket.on('listening', this.onListening.bind(this))
        this.socket.bind(this.contributorPort);
    }

    dispatch(message, rinfo) {
        switch(message.type) {
            case 'ping':
                this.onPing(message, rinfo)
            break
            case 'offer-response':
                this.onOfferResponse(message, rinfo)
            break;
            default:
            this.log('Unknown message', message.type)
        }
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

    onOffer(offer) {
        this.log('got offer', JSON.stringify(offer))
    }

    dispatch(message) {
        switch(message.type) {
            case 'offer':
                this.onOffer(message)
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
const SERVER_ADDR = 'localhost'

let serializer = new JsonSerializer()

let server = new MarketplaceServer(SERVER_PORT, serializer)
server.listen()

let contributor1 = new ContributorClient('1', SERVER_PORT, SERVER_ADDR, serializer)
contributor1.join()


let contributor2 = new ContributorClient('2', SERVER_PORT, SERVER_ADDR, serializer)

setTimeout(function () {
    contributor2.join()
}, 3000)

setTimeout(function () {
    server.offer({
        buyer: 'foxy-news',
        amount: 100,
        currency: 'USD'
    })
}, 2000)

//contributor1.join()
// server.on('message', (msg, rinfo) => {
//   console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
//   let message = parseMsg(msg)
  
// });



// server listening 0.0.0.0:41234