const path = require( "path" );
const process = require( "process" );
const Masto = require( "mastodon" );
const Twitter = require( "twitter-node-client" ).Twitter;
const pretty = require( "js-object-pretty-print" ).pretty
const JFODB = require( "jsonfile-obj-db" );
const resolver = require( "resolver" );

// https://github.com/jhayley/node-mastodon

// https://github.com/BoyCook/TwitterJSClient
// https://developer.twitter.com/en/docs
// https://developer.twitter.com/en/docs/api-reference-index
// https://developer.twitter.com/en/docs/tweets/timelines/overview

function sleep( ms ) { return new Promise( resolve => setTimeout( resolve , ms ) ); }

function escape_html( text ) {
	text = text.replace( /&amp;/g , "&" );
	text = text.replace( /&lt;/g , "<" );
	text = text.replace( /&gt;/g , ">" );
	text = text.replace( /&quot;/g , '"' );
	text = text.replace( /&#039;/g , "'" );
	text = text.replace( /&apos;/g , "'" );
	text = text.replace( /<br\/>/g , "\n" );
	text = text.replace( /<br\ \/>/g , "\n" );
	text = text.replace( /<br>/g , "\n" );
	text = text.replace( /<[^>]+>/g , "" );
	return text;
}

process.on( "unhandledRejection" , function( reason , p ) {
	console.error( reason, "Unhandled Rejection at Promise" , p );
	console.trace();
});
process.on( "uncaughtException" , function( err ) {
	console.error( err , "Uncaught Exception thrown" );
	console.trace();
});

let mastodon = null;
let twitter = null;
let PersonalFilePath = null;
let Personal = null

try{
	PersonalFilePath = path.join( process.env.HOME , ".config" , "personal" , "twitter_mastodon_sync_2.js" );
	console.log( PersonalFilePath );
	Personal = require( PersonalFilePath );
}
catch( error ) { console.log( "Couldn't Locate Config File" ); process.exit( 1 ); }

function _resolve_short_link( x_url ) {
	return new Promise( function( x_resolve , x_reject ) {
		try {
			if ( x_url.indexOf( "http" ) < 0 ) { x_resolve( x_url ); return; }
			resolver.resolve( x_url , function( err , url , filename , contentType ) {
				if ( err ) { x_resolve( false ); return; }
				if ( x_url !== url ) { x_resolve( url ); return; }
				else { x_resolve( x_url ); return; }
				return;
			});
		}
		catch( error ) { console.log( error ); resolve( false ); return; }
	});
}
function ResolveShortLink( url ) {
	return new Promise( async function( resolve , reject ) {
		try {
			console.log( "Resolving: " + url );
			let url_final = await _resolve_short_link( url );
			if ( !url_final ) {
				await sleep( 3000 );
				url_final = await _resolve_short_link( url );
			}
			// if ( !url_final ) {
			// 	await sleep( 10000 );
			// 	url_final = await _resolve_short_link( url );
			// }
			if ( !url_final ) {
				url_final = url;
			}
			console.log( url_final );
			resolve( url_final );
			return;
		}
		catch( error ) { console.log( error ); reject( error ); return; }
	});
}

function TwitterFormatStatuses( tweet_objs ) {
	let final = [];
	for ( let i = 0; i < tweet_objs.length; ++i ) {
		let html_free = escape_html( tweet_objs[ i ].text );
		let include_status_link = false;
		if ( html_free.indexOf( "/video/1") > -1 ) { include_status_link = false; }
		if ( html_free.indexOf( "/photo/1") > -1 ) { include_status_link = false; }
		if ( !include_status_link ) {
			final.push( `${ html_free }` );
		}
		else {
			final.push( `${ html_free } ${ tweet_objs[ i ].url }` );
		}
	}
	return final;
}

function TwitterResolveShortLinks( tweet_objs ) {
	return new Promise( async function( resolve , reject ) {
		try {
			for ( let i = 0; i < tweet_objs.length; ++i ) {
				let final_words = [];
				let lines = tweet_objs[ i ].text.split( "\n" );
				lines = lines.join( " " );
				let words = lines.split( " " );
				for ( let j = 0; j < words.length; ++j ) {
					let word = words[ j ].trim();
					let test = word.indexOf( "http" );
					if ( parseInt( test ) < 0 ) { final_words.push( word ); continue; }
					//console.log( `Word = ${ word } = ${ test.toString() }` );
					if ( words[ j ].indexOf( "http" ) > -1 ) {
						let resolved = await ResolveShortLink( word );
						words[ j ] = resolved;
					}
					final_words.push( words[ j ] );
				}
				final_words = final_words.join( " " );
				tweet_objs[ i ].text = final_words;
			}
			resolve( tweet_objs );
			return;
		}
		catch( error ) { console.log( error ); reject( error ); return; }
	});
}
function TwitterParseLatest( tweets ) {
	try {
		tweets = JSON.parse( tweets );
		if ( !tweets ) { console.log( "could not parse" ); return false; }
		let results = [];
		for ( let i = 0; i < tweets.length; ++i ) {
			let local_id = tweets[ i ].id_str;
			let final_id = tweets[ i ].id_str;
			let final_created_at = tweets[ i ].created_at;
			let final_screen_name = tweets[ i ].user.screen_name;
			let final_text = tweets[ i ].full_text;
			let final_url = false;
			if ( tweets[ i ].retweeted ) {
				if ( tweets[ i ].retweeted_status ) {
					if ( tweets[ i ].retweeted_status.full_text ) {
						if ( tweets[ i ].retweeted_status.full_text.length > 1 ) {
							final_id = tweets[ i ].retweeted_status.id_str;
							final_created_at = tweets[ i ].retweeted_status.user.created_at;
							final_screen_name = tweets[ i ].retweeted_status.user.screen_name;
							final_text = tweets[ i ].retweeted_status.full_text;
							final_url = `https://twitter.com/${ final_screen_name }/status/${ final_id }`;
						}
					}
				}
			}
			let obj  = {
				local_id: local_id ,
				id: final_id ,
				created_at: final_created_at ,
				text: final_text ,
			}
			if ( final_id ) { obj.url = final_url; }
			results.push( obj );
		}
		return results;
	}
	catch( error ) { console.log( error ); return error; }
}
function TwitterGetLatest( user_name , since_id ) {
	return new Promise( function( resolve , reject ) {
		try {
			let options = { screen_name: user_name , count: '10' , tweet_mode: 'extended' };
			if ( since_id ) { options.since_id = since_id; }
			twitter.getUserTimeline( options ,
				( err , resonse , body ) => {
					console.log( 'ERROR [%s]' , err );
					reject( err );
					return;
				} ,
				async ( data ) => {
					let parsed = TwitterParseLatest( data );
					let resolved = await TwitterResolveShortLinks( parsed );
					let formated_statuses = TwitterFormatStatuses( resolved );
					let final = [];
					for ( let i = 0; i < formated_statuses.length; ++i ) {
						let obj = resolved[ i ];
						obj.formated_status = formated_statuses[ i ];
						final.push( obj );
					}
					resolve( final );
					return;
				}
			);
		}
		catch( error ) { console.log( error ); reject( error ); return; }
	});
}

function MastodonPostStatus( status ) {
	return new Promise( async function( resolve , reject ) {
		try {
			if ( !mastodon ) { resolve( "mastodon not connected" ); return; }
			console.log( "mastodon.js --> post()" );
			await mastodon.post( "statuses" , { status: status } );
			resolve();
			return;
		}
		catch( error ) { console.log( error ); reject( error ); return; }
	});
}


( async ()=> {

	const db = new JFODB( "twitter_" + Personal.twitter.username + "_mastodon_sync" );

	mastodon = new Masto( Personal.mastodon.creds );
	await sleep( 2000 );
	twitter = new Twitter( Personal.twitter.creds );

	setInterval( async function() {
		let latest = await TwitterGetLatest( Personal.twitter.username , db.self[ "twitter_self_latest_id" ] || false );
		if ( !latest ) { console.log( "Nothing New" ); /* process.exit( 1 ); */ return; }
		if ( latest.length < 1 ) { console.log( "Nothing New" ); /* process.exit( 1 ); */ return; }
		db.self[ "twitter_self_timeline_latest" ] = [];
		db.self[ "twitter_self_timeline_latest" ] = latest;
		db.save();

		console.log( pretty( db.self[ "twitter_self_timeline_latest" ] ) );
		latest = latest.reverse();
		for ( let i = 0; i < latest.length; ++i ) {
			await MastodonPostStatus( latest[ i ].formated_status );
			db.self[ "twitter_self_latest_id" ] = latest[ i ][ "local_id" ];
			db.save();
			await sleep( 500 );
		}
	} , 30000 );

})();