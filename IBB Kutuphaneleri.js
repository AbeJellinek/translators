{
	"translatorID": "cbfbf2b7-df6b-474a-b450-f3de42d980f4",
	"label": "İBB Kütüphaneleri",
	"creator": "Abe Jellinek",
	"target": "^https://katalog\\.ibb\\.gov\\.tr/yordam/",
	"minVersion": "5.0",
	"maxVersion": "",
	"priority": 98,
	"inRepository": true,
	"translatorType": 12,
	"browserSupport": "gcsibv",
	"lastUpdated": "2024-10-01 13:35:48"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2024 Abe Jellinek
	
	This file is part of Zotero.

	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero. If not, see <http://www.gnu.org/licenses/>.

	***** END LICENSE BLOCK *****
*/

const turkishISBNRe = /^(97[89])?(605|625|975|9944)/;

const creatorTypes = {
	edi: 'editor', // Editör: 'editor'
	düz: 'editor', // Düzelti: 'correction'
	haz: 'editor', // Hazırlık: 'preparation'
	çev: 'translator', // Çevirme: 'translation'
	res: 'contributor', // Resimleme: 'illustration'
	// And likely others
};

function detectWeb(doc) {
	if (doc.querySelector('.modal [data-recordid]')) {
		return 'book';
	}
	else if (getSearchResults(doc, true)) {
		return 'multiple';
	}
	return false;
}

async function doWeb(doc) {
	if (doc.querySelector('.modal [data-recordid]')) {
		await processMARC(attr(doc, '.modal [data-recordid]', 'data-recordid'));
	}
	else if (getSearchResults(doc, true)) {
		let items = await Zotero.selectItems(getSearchResults(doc));
		for (let recordID of Object.keys(items)) {
			await processMARC(recordID);
		}
	}
}

function getSearchResults(doc, checkOnly) {
	var items = {};
	var found = false;
	var rows = doc.querySelectorAll('[data-recordid]');
	for (let row of rows) {
		let recordID = row.getAttribute('data-recordid');
		let title = row.getAttribute('data-eseradi') || '[Başlıksız]';
		if (!recordID || !title) continue;
		if (checkOnly) return true;
		found = true;
		items[recordID] = title;
	}
	return found ? items : false;
}

function detectSearch(item) {
	if (typeof item.ISBN === 'string') {
		let isbn = ZU.cleanISBN(item.ISBN);
		return turkishISBNRe.test(isbn);
	}
	return false;
}

async function doSearch(item) {
	let original = ZU.cleanISBN(item.ISBN);
	let hyphenatedOriginal = ibbHyphenateISBN(original);
	let asISBN13 = ZU.toISBN13(original);
	let hyphenatedAsISBN13 = ibbHyphenateISBN(asISBN13);
	let variations = new Set([original, '"' + hyphenatedOriginal + '"', asISBN13, '"' + hyphenatedAsISBN13 + '"']);
	for (let isbn of variations) {
		let recordID = await getRecordID(isbn);
		if (recordID) {
			await processMARC(recordID);
			break;
		}
	}
}

async function getRecordID(isbn) {
	let url = `https://katalog.ibb.gov.tr/yordam/?p=1&q=${encodeURIComponent(isbn)}&alan=kunyeISBNISSN_txt`;
	let doc = await requestDocument(url);
	return attr(doc, 'div[data-recordid]', 'data-recordid');
}

async function processMARC(recordID) {
	let json = await requestJSON('https://katalog.ibb.gov.tr/yordam/inc/islem.inc.php', {
		method: 'POST',
		headers: {
			Referer: 'https://katalog.ibb.gov.tr/yordam/',
			Accept: 'application/json',
			'X-Requested-With': 'XMLHttpRequest'
		},
		body: `islem=marcGetir&recordid=${recordID}`,
	});
	
	let trans = Z.loadTranslator('import');
	trans.setTranslator('a6ee60df-1ddc-4aae-bb25-45e0537be973'); // MARC
	let marc = await trans.getTranslatorObject();
	
	let record = new marc.record();
	for (let line of ZU.unescapeHTML(json.kunyeMarcMrk).split('\n')) {
		if (!line) continue;
		let field = line.substring(1, 4);
		line = line.substring(5);
		if (field === 'LDR') {
			record.leader = line;
		}
		else {
			let subfields;
			if (/^[\d_]{2}$/.test(line)) {
				subfields = line.substring(0, 2).replace(/_/g, ' ');
				line = line.substring(2);
			}
			else {
				subfields = '  ';
			}
			line = line.replace(/\$/g, marc.subfieldDelimiter);
			record.addField(field, subfields, line);
		}
	}

	let item = new Zotero.Item();
	record.translate(item);

	if (item.series && item.publisher && item.series.includes(item.publisher)) {
		delete item.series;
	}
	if (item.edition) {
		item.edition = item.edition.replace(/\.\s*(bs|baskı)/, '');
	}
	if (item.language === 'tur') {
		item.language = 'tr';
	}

	for (let creator of item.creators) {
		// Look for creator type abbreviations
		if (!creator.firstName) continue;
		let creatorType = creator.firstName.match(/^(\p{Ll}{3,})[.\s]+/u);
		if (creatorType) {
			// If a known type, use it
			if (creatorTypes[creatorType[1]]) {
				creator.creatorType = creatorTypes[creatorType[1]];
			}
			else {
				Z.debug('Unknown creator type: ' + creatorType[1]);
				creator.creatorType = 'contributor'; // Maybe?
			}
			creator.firstName = creator.firstName.substring(creatorType[0].length);
		}
	}

	item.complete();
}

// Copied from Zotero.Utilities.Internal.hyphenateISBN()
function ibbHyphenateISBN(isbn) {
	// Copied from isbn.js
	var ISBN = {};
	ISBN.ranges = (function () {
		/* eslint-disable */
		var ranges = {"978":{"0":["00","19","200","699","7000","8499","85000","89999","900000","949999","9500000","9999999"],"1":["00","09","100","329","330","399","4000","5499","55000","86979","869800","998999","9990000","9999999"],"2":["00","19","200","349","400","699","7000","8399","35000","39999","84000","89999","900000","949999","9500000","9999999"],"3":["00","02","04","19","030","033","200","699","0340","0369","7000","8499","03700","03999","85000","89999","95400","96999","99000","99499","99500","99999","900000","949999","9500000","9539999","9700000","9899999"],"5":["01","19","200","420","430","430","440","440","450","699","0050","0099","4210","4299","4310","4399","4410","4499","7000","8499","9200","9299","9501","9799","9910","9999","00000","00499","85000","89999","91000","91999","93000","94999","98000","98999","900000","909999","9500000","9500999","9900000","9909999"],"600":["00","09","100","499","5000","8999","90000","99999"],"601":["00","19","85","99","200","699","7000","7999","80000","84999"],"602":["00","07","200","699","0800","0899","0900","1099","1100","1199","1200","1399","1500","1699","7500","7999","8000","9499","14000","14999","17000","17999","18000","18999","19000","19999","70000","74999","95000","99999"],"603":["00","04","05","49","500","799","8000","8999","90000","99999"],"604":["0","4","50","89","900","979","9800","9999"],"605":["01","02","04","09","030","039","100","399","4000","5999","9000","9999","60000","89999"],"606":["0","0","10","49","500","799","8000","9199","92000","99999"],"607":["00","39","400","749","7500","9499","95000","99999"],"608":["0","0","7","9","10","19","200","449","4500","6499","65000","69999"],"609":["00","39","400","799","8000","9499","95000","99999"],"612":["00","29","50","99","300","399","4000","4499","45000","49999"],"613":["0","9"],"615":["00","09","100","499","5000","7999","80000","89999"],"616":["00","19","200","699","7000","8999","90000","99999"],"617":["00","49","500","699","7000","8999","90000","99999"],"618":["00","19","200","499","5000","7999","80000","99999"],"619":["00","14","150","699","7000","8999","90000","99999"],"621":["00","29","400","599","8000","8999","95000","99999"],"7":["00","09","100","499","5000","7999","80000","89999","900000","999999"],"80":["00","19","200","699","7000","8499","85000","89999","900000","999999"],"82":["00","19","200","689","7000","8999","90000","98999","690000","699999","990000","999999"],"83":["00","19","200","599","7000","8499","60000","69999","85000","89999","900000","999999"],"84":["00","13","140","149","200","699","7000","8499","9000","9199","9700","9999","15000","19999","85000","89999","92400","92999","95000","96999","920000","923999","930000","949999"],"85":["00","19","200","549","5500","5999","7000","8499","60000","69999","85000","89999","98000","99999","900000","979999"],"86":["00","29","300","599","6000","7999","80000","89999","900000","999999"],"87":["00","29","400","649","7000","7999","85000","94999","970000","999999"],"88":["00","19","200","599","910","929","6000","8499","9300","9399","85000","89999","95000","99999","900000","909999","940000","949999"],"89":["00","24","250","549","990","999","5500","8499","85000","94999","97000","98999","950000","969999"],"90":["00","19","90","90","94","94","200","499","5000","6999","8500","8999","70000","79999","800000","849999"],"91":["0","1","20","49","500","649","7000","7999","85000","94999","970000","999999"],"92":["0","5","60","79","800","899","9000","9499","95000","98999","990000","999999"],"93":["00","09","100","499","5000","7999","80000","94999","950000","999999"],"94":["000","599","6000","8999","90000","99999"],"950":["00","49","500","899","9000","9899","99000","99999"],"951":["0","1","20","54","550","889","8900","9499","95000","99999"],"952":["00","19","60","65","80","94","200","499","5000","5999","6600","6699","7000","7999","9500","9899","67000","69999","99000","99999"],"953":["0","0","10","14","51","54","150","509","6000","9499","55000","59999","95000","99999"],"954":["00","28","300","799","2900","2999","8000","8999","9300","9999","90000","92999"],"955":["20","40","550","749","0000","1999","4500","4999","7500","7999","8000","9499","41000","43999","44000","44999","50000","54999","95000","99999"],"956":["00","19","200","699","7000","9999"],"957":["00","02","05","19","21","27","31","43","440","819","0300","0499","2000","2099","8200","9699","28000","30999","97000","99999"],"958":["00","56","600","799","8000","9499","57000","59999","95000","99999"],"959":["00","19","200","699","7000","8499","85000","99999"],"960":["00","19","93","93","200","659","690","699","6600","6899","7000","8499","9400","9799","85000","92999","98000","99999"],"961":["00","19","200","599","6000","8999","90000","94999"],"962":["00","19","200","699","900","999","7000","8499","8700","8999","85000","86999"],"963":["00","19","200","699","7000","8499","9000","9999","85000","89999"],"964":["00","14","150","249","300","549","970","989","2500","2999","5500","8999","9900","9999","90000","96999"],"965":["00","19","200","599","7000","7999","90000","99999"],"966":["00","12","14","14","130","139","170","199","279","289","300","699","910","949","980","999","1500","1699","2000","2789","2900","2999","7000","8999","90000","90999","95000","97999"],"967":["00","00","60","89","300","499","900","989","0100","0999","5000","5999","9900","9989","10000","19999","99900","99999"],"968":["01","39","400","499","800","899","5000","7999","9000","9999"],"969":["0","1","20","22","24","39","400","749","7500","9999","23000","23999"],"970":["01","59","600","899","9000","9099","9700","9999","91000","96999"],"971":["02","02","06","49","97","98","000","015","500","849","0160","0199","0300","0599","8500","9099","9600","9699","9900","9999","91000","95999"],"972":["0","1","20","54","550","799","8000","9499","95000","99999"],"973":["0","0","20","54","100","169","550","759","1700","1999","7600","8499","8900","9499","85000","88999","95000","99999"],"974":["00","19","200","699","7000","8499","9500","9999","85000","89999","90000","94999"],"975":["02","24","250","599","990","999","6000","9199","00000","01999","92000","98999"],"976":["0","3","40","59","600","799","8000","9499","95000","99999"],"977":["00","19","90","99","200","499","700","849","5000","6999","85000","89999"],"978":["000","199","900","999","2000","2999","8000","8999","30000","79999"],"979":["20","29","000","099","400","799","1000","1499","3000","3999","8000","9499","15000","19999","95000","99999"],"980":["00","19","200","599","6000","9999"],"981":["00","11","200","289","290","299","310","399","3000","3099","4000","9999","17000","19999"],"982":["00","09","70","89","100","699","9000","9799","98000","99999"],"983":["00","01","45","49","50","79","020","199","800","899","2000","3999","9000","9899","40000","44999","99000","99999"],"984":["00","39","400","799","8000","8999","90000","99999"],"985":["00","39","400","599","6000","8999","90000","99999"],"986":["00","11","120","559","5600","7999","80000","99999"],"987":["00","09","30","35","40","44","500","899","1000","1999","3600","3999","9000","9499","20000","29999","45000","49999","95000","99999"],"988":["00","11","200","799","8000","9699","12000","14999","15000","16999","17000","19999","97000","99999"],"9925":["0","2","30","54","550","734","7350","9999"],"9926":["0","1","20","39","400","799","8000","9999"],"9927":["00","09","100","399","4000","4999"],"9929":["0","3","40","54","550","799","8000","9999"],"9930":["00","49","500","939","9400","9999"],"9931":["00","29","300","899","9000","9999"],"9932":["00","39","400","849","8500","9999"],"9933":["0","0","10","39","400","899","9000","9999"],"9934":["0","0","10","49","500","799","8000","9999"],"9937":["0","2","30","49","500","799","8000","9999"],"9938":["00","79","800","949","9500","9999"],"9939":["0","4","50","79","800","899","9000","9999"],"9940":["0","1","20","49","500","899","9000","9999"],"9942":["00","84","900","984","8500","8999","9850","9999"],"9943":["00","29","300","399","975","999","4000","9749"],"9944":["60","69","80","89","100","499","700","799","900","999","0000","0999","5000","5999"],"9945":["00","00","08","39","57","57","010","079","400","569","580","849","8500","9999"],"9946":["0","1","20","39","400","899","9000","9999"],"9947":["0","1","20","79","800","999"],"9949":["0","0","10","39","75","89","400","749","9000","9999"],"9950":["00","29","300","849","8500","9999"],"9953":["0","0","10","39","60","89","400","599","9000","9999"],"9955":["00","39","400","929","9300","9999"],"9957":["00","39","70","84","88","99","400","699","8500","8799"],"9958":["00","01","10","18","20","49","020","029","040","089","500","899","0300","0399","0900","0999","1900","1999","9000","9999"],"9959":["0","1","20","79","98","99","800","949","970","979","9500","9699"],"9960":["00","59","600","899","9000","9999"],"9961":["0","2","30","69","700","949","9500","9999"],"9962":["00","54","56","59","600","849","5500","5599","8500","9999"],"9963":["0","1","30","54","250","279","550","734","2000","2499","2800","2999","7350","7499","7500","9999"],"9964":["0","6","70","94","950","999"],"9965":["00","39","400","899","9000","9999"],"9966":["20","69","000","149","750","959","1500","1999","7000","7499","9600","9999"],"9971":["0","5","60","89","900","989","9900","9999"],"9972":["1","1","00","09","30","59","200","249","600","899","2500","2999","9000","9999"],"9973":["00","05","10","69","060","089","700","969","0900","0999","9700","9999"],"9974":["0","2","30","54","95","99","550","749","7500","9499"],"9975":["0","0","45","89","100","299","900","949","3000","3999","4000","4499","9500","9999"],"9977":["00","89","900","989","9900","9999"],"9978":["00","29","40","94","300","399","950","989","9900","9999"],"9979":["0","4","50","64","66","75","650","659","760","899","9000","9999"],"9980":["0","3","40","89","900","989","9900","9999"],"9981":["00","09","20","79","100","159","800","949","1600","1999","9500","9999"],"9982":["00","79","800","989","9900","9999"],"9983":["80","94","950","989","9900","9999"],"9984":["00","49","500","899","9000","9999"],"9986":["00","39","97","99","400","899","940","969","9000","9399"],"9987":["00","39","400","879","8800","9999"],"9988":["0","2","30","54","550","749","7500","9999"],"9989":["0","0","30","59","100","199","600","949","2000","2999","9500","9999"],"99901":["00","49","80","99","500","799"],"99903":["0","1","20","89","900","999"],"99904":["0","5","60","89","900","999"],"99905":["0","3","40","79","800","999"],"99906":["0","2","30","59","70","89","90","94","600","699","950","999"],"99908":["0","0","10","89","900","999"],"99909":["0","3","40","94","950","999"],"99910":["0","2","30","89","900","999"],"99911":["00","59","600","999"],"99912":["0","3","60","89","400","599","900","999"],"99913":["0","2","30","35","600","604"],"99914":["0","4","50","89","900","999"],"99915":["0","4","50","79","800","999"],"99916":["0","2","30","69","700","999"],"99919":["0","2","40","69","70","79","300","399","800","849","850","899","900","999"],"99921":["0","1","8","8","20","69","90","99","700","799"],"99922":["0","3","40","69","700","999"],"99926":["0","0","10","59","87","89","90","99","600","869"],"99927":["0","2","30","59","600","999"],"99928":["0","0","10","79","800","999"],"99932":["0","0","7","7","10","59","80","99","600","699"],"99935":["0","2","7","8","30","59","90","99","600","699"],"99936":["0","0","10","59","600","999"],"99937":["0","1","20","59","600","999"],"99938":["0","1","20","59","90","99","600","899"],"99940":["0","0","10","69","700","999"],"99941":["0","2","30","79","800","999"],"99953":["0","2","30","79","94","99","800","939"],"99954":["0","2","30","69","88","99","700","879"],"99955":["0","1","20","59","80","99","600","799"],"99956":["00","59","86","99","600","859"],"99958":["0","4","50","93","940","949","950","999"],"99960":["0","0","10","94","950","999"],"99961":["0","3","40","89","900","999"],"99963":["00","49","92","99","500","919"],"99966":["0","2","30","69","80","94","700","799"],"99967":["0","1","20","59","600","899"],"99971":["0","5","60","84","850","999"],"99974":["40","79","800","999"],"99976":["0","1","20","59","600","799"]},"979":{"10":["00","19","200","699","7000","8999","90000","97599","976000","999999"],"11":["00","24","250","549","5500","8499","85000","94999","950000","999999"],"12":["200","200"]}};
		ranges['978']['99968']=ranges['978']['99912'];ranges['978']['9935']=ranges['978']['9941']=ranges['978']['9956']=ranges['978']['9933'];ranges['978']['9976']=ranges['978']['9971'];ranges['978']['99949']=ranges['978']['99903'];ranges['978']['9968']=ranges['978']['9930'];ranges['978']['99929']=ranges['978']['99930']=ranges['978']['99931']=ranges['978']['99942']=ranges['978']['99944']=ranges['978']['99948']=ranges['978']['99950']=ranges['978']['99952']=ranges['978']['99962']=ranges['978']['99969']=ranges['978']['99915'];ranges['978']['99917']=ranges['978']['99910'];ranges['978']['99920']=ranges['978']['99970']=ranges['978']['99972']=ranges['978']['99914'];ranges['978']['99933']=ranges['978']['99943']=ranges['978']['99946']=ranges['978']['99959']=ranges['978']['99927'];ranges['978']['81']=ranges['978']['80'];ranges['978']['9967']=ranges['978']['9970']=ranges['978']['9965'];ranges['978']['9936']=ranges['978']['9952']=ranges['978']['9954']=ranges['978']['9926'];ranges['978']['99965']=ranges['978']['99922'];ranges['978']['9928']=ranges['978']['9927'];ranges['978']['99947']=ranges['978']['99916'];ranges['978']['9985']=ranges['978']['9939'];ranges['978']['99918']=ranges['978']['99925']=ranges['978']['99973']=ranges['978']['99975']=ranges['978']['99905'];ranges['978']['99939']=ranges['978']['99945']=ranges['978']['99904'];ranges['978']['989']=ranges['978']['972'];ranges['978']['620']=ranges['978']['613'];ranges['978']['4']=ranges['978']['0'];ranges['978']['99923']=ranges['978']['99924']=ranges['978']['99934']=ranges['978']['99957']=ranges['978']['99964']=ranges['978']['9947'];ranges['978']['614']=ranges['978']['609'];ranges['978']['9948']=ranges['978']['9951']=ranges['978']['9932'];
		/* eslint-enable */
		return ranges;
	})();
	var ranges = ISBN.ranges,
		parts = [],
		uccPref,
		i = 0;
	if (isbn.length == 10) {
		uccPref = '978';
	}
	else {
		uccPref = isbn.substr(0, 3);
		if (!ranges[uccPref]) return ''; // Probably invalid ISBN, but the checksum is OK
		parts.push(uccPref);
		i = 3; // Skip ahead
	}
	
	var group = '',
		found = false;
	while (i < isbn.length - 3 /* check digit, publication, registrant */) {
		group += isbn.charAt(i);
		if (ranges[uccPref][group]) {
			parts.push(group);
			found = true;
			break;
		}
		i++;
	}
	
	if (!found) return ''; // Did not find a valid group
	
	// Array of registrant ranges that are valid for a group
	// Array always contains an even number of values (as string)
	// From left to right, the values are paired so that the first indicates a
	// lower bound of the range and the right indicates an upper bound
	// The ranges are sorted by increasing number of characters
	var regRanges = ranges[uccPref][group];
	
	var registrant = '';
	found = false;
	i++; // Previous loop 'break'ed early
	while (!found && i < isbn.length - 2 /* check digit, publication */) {
		registrant += isbn.charAt(i);
		
		for (let j = 0; j < regRanges.length && registrant.length >= regRanges[j].length; j += 2) {
			if (registrant.length == regRanges[j].length
				&& registrant >= regRanges[j] && registrant <= regRanges[j + 1] // Falls within the range
			) {
				parts.push(registrant);
				found = true;
				break;
			}
		}
		
		i++;
	}
	
	if (!found) return ''; // Outside of valid range, but maybe we need to update our data
	
	parts.push(isbn.substring(i, isbn.length - 1)); // Publication is the remainder up to last digit
	parts.push(isbn.charAt(isbn.length - 1)); // Check digit
	
	return parts.join('-');
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "search",
		"input": {
			"ISBN": "975-470-711-1"
		},
		"items": [
			{
				"itemType": "book",
				"title": "Benim adım kırmızı",
				"creators": [
					{
						"firstName": "Orhan",
						"lastName": "Pamuk",
						"creatorType": "author"
					}
				],
				"date": "1999",
				"ISBN": "9789754707113",
				"callNumber": "T813.317 PAM 1999",
				"edition": "9",
				"language": "tr",
				"libraryCatalog": "İBB Kütüphaneleri",
				"numPages": "472",
				"place": "İstanbul",
				"publisher": "İletişim",
				"seriesNumber": "510",
				"attachments": [],
				"tags": [
					{
						"tag": "Türk Romanı"
					}
				],
				"notes": [
					{
						"note": "Kültür A.Ş"
					}
				],
				"seeAlso": []
			}
		]
	},
	{
		"type": "search",
		"input": {
			"ISBN": "978-975-07-2332-2"
		},
		"items": [
			{
				"itemType": "book",
				"title": "Ateşten gömlek",
				"creators": [
					{
						"firstName": "Halide Edib",
						"lastName": "Adıvar",
						"creatorType": "author"
					},
					{
						"firstName": "Mustafa",
						"lastName": "Çevikdoğan",
						"creatorType": "editor"
					}
				],
				"date": "2022",
				"ISBN": "9789750723322",
				"callNumber": "813.41 ADI 2022",
				"edition": "53",
				"language": "tr",
				"libraryCatalog": "İBB Kütüphaneleri",
				"numPages": "211",
				"place": "İstanbul",
				"publisher": "Can",
				"attachments": [],
				"tags": [
					{
						"tag": "Türk Romanı"
					}
				],
				"notes": [
					{
						"note": "Selim İleri’nin sonsözüyle"
					}
				],
				"seeAlso": []
			}
		]
	},
	{
		"type": "search",
		"input": {
			"ISBN": "9756747218"
		},
		"items": [
			{
				"itemType": "book",
				"title": "Söylev",
				"creators": [
					{
						"firstName": "Gazi Mustafa Kemal",
						"lastName": "Atatürk",
						"creatorType": "author"
					},
					{
						"firstName": "Hıfzı Veldet",
						"lastName": "Velidedeoğlu",
						"creatorType": "editor"
					}
				],
				"date": "2004",
				"ISBN": "9789756747216",
				"callNumber": "956.1024 ATA 2004 c.1-2",
				"language": "tr",
				"libraryCatalog": "İBB Kütüphaneleri",
				"numPages": "416",
				"place": "İstanbul",
				"publisher": "Cumhuriyet",
				"attachments": [],
				"tags": [
					{
						"tag": "Atatürk dönemi"
					},
					{
						"tag": "Cumhuriyet dönemi"
					},
					{
						"tag": "Tarih"
					},
					{
						"tag": "Türkiye"
					}
				],
				"notes": [
					{
						"note": "Atatürk"
					}
				],
				"seeAlso": []
			}
		]
	},
	{
		"type": "search",
		"input": {
			"ISBN": "978-975-468-595-4"
		},
		"items": [
			{
				"itemType": "book",
				"title": "Şehir mektupları",
				"creators": [
					{
						"lastName": "Ahmed Rasim",
						"creatorType": "author"
					},
					{
						"firstName": "Korkut",
						"lastName": "Tankuter",
						"creatorType": "contributor"
					},
					{
						"firstName": "Handan",
						"lastName": "İnci",
						"creatorType": "contributor"
					}
				],
				"ISBN": "9789754685954",
				"callNumber": "ÇT814.313 AHM",
				"libraryCatalog": "İBB Kütüphaneleri",
				"numPages": "140",
				"place": "İstanbul",
				"publisher": "Say Yayınları & Sabah Gazetesi",
				"series": "Say Yayınları 100 Temel Eser",
				"seriesNumber": "6",
				"attachments": [],
				"tags": [
					{
						"tag": "Türk Denemeleri"
					}
				],
				"notes": [
					{
						"note": "Sabah Gazetesi : 100 Temel Eser Serisi Ç T814/AHM"
					}
				],
				"seeAlso": []
			}
		]
	},
	{
		"type": "search",
		"input": {
			"ISBN": "978-605-106-844-2"
		},
		"items": [
			{
				"itemType": "book",
				"title": "Beynin ötesi: beden ve çevre, hayvan ve insan zihnini nasıl şekillendirir",
				"creators": [
					{
						"firstName": "Louise",
						"lastName": "Barrett",
						"creatorType": "author"
					},
					{
						"firstName": "İlkay Alptekin",
						"lastName": "Demir",
						"creatorType": "translator"
					},
					{
						"firstName": "Kerem",
						"lastName": "Cankoçak",
						"creatorType": "editor"
					}
				],
				"date": "2017",
				"ISBN": "9786051068442",
				"callNumber": "575 BAR 2017",
				"edition": "2",
				"language": "tr",
				"libraryCatalog": "İBB Kütüphaneleri",
				"numPages": "300",
				"place": "İstanbul",
				"publisher": "Alfa",
				"seriesNumber": "2547",
				"shortTitle": "Beynin ötesi",
				"attachments": [],
				"tags": [
					{
						"tag": "Beyin - Evrim"
					},
					{
						"tag": "Evrim (Biyoloji)"
					}
				],
				"notes": [
					{
						"note": "Kaynakça: s. 281-298 Dizin var"
					}
				],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://katalog.ibb.gov.tr/yordam/?p=1&q=Han%C4%B1m&alan=tum_txt&fq[]=kunyeAnaTurKN_str%3A%220400%22#demirbas=FA_Evr_000001003_Evr_000001003&demirbas=Bel_Mtf_053032_Mtf_053032",
		"items": [
			{
				"itemType": "book",
				"title": "Tanımlanamayan fotoğraf",
				"creators": [],
				"callNumber": "t.y.",
				"libraryCatalog": "İBB Kütüphaneleri",
				"numPages": "1",
				"attachments": [],
				"tags": [
					{
						"tag": "Kişisel Belgeler; Fotoğraflar"
					}
				],
				"notes": [
					{
						"note": "Genç bir hanım"
					}
				],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://katalog.ibb.gov.tr/yordam/?p=1&q=La+Bourboule&alan=tum_txt#",
		"items": "multiple"
	}
]
/** END TEST CASES **/
