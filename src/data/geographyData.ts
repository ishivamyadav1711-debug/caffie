/**
 * Canonical Geography Dataset for LeadPilot
 * Supports:
 * - USA: 50 states + District of Columbia (US)
 * - Canada: 10 provinces + 3 territories (CA)
 * - India: 28 states + 8 Union Territories (IN)
 * 
 * Strict cross-country and cross-state validation.
 * Supports resolving cities via Google Places rather than assuming static city lists are exhaustive.
 */

import { INDIAN_STATES_AND_UTS, COMMON_CITY_ALIASES } from './indiaLocations';

export interface StateRegion {
  name: string;
  code: string;
  type: 'State' | 'Province' | 'Territory' | 'Union Territory' | 'District';
  countryCode: 'US' | 'CA' | 'IN';
  country: 'USA' | 'Canada' | 'India';
  cities: string[];
}

export interface CountryInfo {
  id: 'USA' | 'Canada' | 'India';
  name: string;
  code: 'US' | 'CA' | 'IN';
  subdivisionLabel: 'State' | 'Province / Territory' | 'State / UT';
  regions: StateRegion[];
}

// ==========================================
// USA: 50 STATES + DISTRICT OF COLUMBIA
// ==========================================
export const USA_STATES: StateRegion[] = [
  {
    name: 'Alabama',
    code: 'AL',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Birmingham', 'Montgomery', 'Mobile', 'Huntsville', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison'],
  },
  {
    name: 'Alaska',
    code: 'AK',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Wasilla', 'Kenai', 'Kodiak', 'Bethel', 'Palmer'],
  },
  {
    name: 'Arizona',
    code: 'AZ',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe', 'Peoria', 'Surprise', 'Yuma', 'Flagstaff'],
  },
  {
    name: 'Arkansas',
    code: 'AR',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'Rogers', 'Conway', 'North Little Rock', 'Bentonville', 'Pine Bluff'],
  },
  {
    name: 'California',
    code: 'CA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: [
      'Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento',
      'Fresno', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim',
      'Santa Ana', 'Riverside', 'Stockton', 'Irvine', 'Chula Vista',
      'Fremont', 'San Bernardino', 'Modesto', 'Fontana', 'Oxnard',
      'Moreno Valley', 'Huntington Beach', 'Glendale', 'Santa Clarita', 'Garden Grove',
      'Oceanside', 'Rancho Cucamonga', 'Santa Rosa', 'Ontario', 'Elk Grove',
      'Corona', 'Lancaster', 'Palmdale', 'Salinas', 'Hayward',
      'Pomona', 'Escondido', 'Sunnyvale', 'Torrance', 'Pasadena',
      'Orange', 'Fullerton', 'Thousand Oaks', 'Visalia', 'Simi Valley',
      'Concord', 'Roseville', 'Santa Clara', 'Vallejo', 'Berkeley'
    ],
  },
  {
    name: 'Colorado',
    code: 'CO',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder', 'Greeley'],
  },
  {
    name: 'Connecticut',
    code: 'CT',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'West Hartford', 'Greenwich'],
  },
  {
    name: 'Delaware',
    code: 'DE',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
  },
  {
    name: 'District of Columbia',
    code: 'DC',
    type: 'District',
    countryCode: 'US',
    country: 'USA',
    cities: ['Washington'],
  },
  {
    name: 'Florida',
    code: 'FL',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: [
      'Miami', 'Orlando', 'Tampa', 'Jacksonville', 'St. Petersburg',
      'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral',
      'Pembroke Pines', 'Hollywood', 'Miramar', 'Gainesville', 'Coral Springs',
      'Clearwater', 'Palm Bay', 'Pompano Beach', 'West Palm Beach', 'Lakeland'
    ],
  },
  {
    name: 'Georgia',
    code: 'GA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany', 'Warner Robins', 'Alpharetta'],
  },
  {
    name: 'Hawaii',
    code: 'HI',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Honolulu', 'East Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani', 'Kahului', 'Kihei'],
  },
  {
    name: 'Idaho',
    code: 'ID',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Caldwell', 'Pocatello', 'Coeur d\'Alene', 'Twin Falls', 'Post Falls', 'Lewiston'],
  },
  {
    name: 'Illinois',
    code: 'IL',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford', 'Springfield', 'Elgin', 'Peoria', 'Champaign', 'Waukegan', 'Cicero', 'Bloomington'],
  },
  {
    name: 'Indiana',
    code: 'IN',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette', 'Muncie', 'Terre Haute'],
  },
  {
    name: 'Iowa',
    code: 'IA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Ames', 'West Des Moines', 'Council Bluffs', 'Dubuque'],
  },
  {
    name: 'Kansas',
    code: 'KS',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina'],
  },
  {
    name: 'Kentucky',
    code: 'KY',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville'],
  },
  {
    name: 'Louisiana',
    code: 'LA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma'],
  },
  {
    name: 'Maine',
    code: 'ME',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Sanford', 'Saco', 'Westbrook', 'Augusta'],
  },
  {
    name: 'Maryland',
    code: 'MD',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Hagerstown', 'Annapolis', 'College Park', 'Salisbury', 'Laurel'],
  },
  {
    name: 'Massachusetts',
    code: 'MA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'New Bedford', 'Quincy', 'Lynn', 'Fall River', 'Newton', 'Somerville'],
  },
  {
    name: 'Michigan',
    code: 'MI',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint', 'Dearborn', 'Livonia', 'Troy', 'Westland', 'Kalamazoo'],
  },
  {
    name: 'Minnesota',
    code: 'MN',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Minneapolis', 'Saint Paul', 'Rochester', 'Bloomington', 'Duluth', 'Brooklyn Park', 'Plymouth', 'Woodbury', 'Lakeville', 'St. Cloud', 'Eagan'],
  },
  {
    name: 'Mississippi',
    code: 'MS',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Jackson', 'Gulfport', 'Southaven', 'Biloxi', 'Hattiesburg', 'Olive Branch', 'Tupelo', 'Meridian', 'Clinton', 'Madison'],
  },
  {
    name: 'Missouri',
    code: 'MO',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Kansas City', 'Saint Louis', 'Springfield', 'Columbia', 'Independence', 'Lee\'s Summit', 'O\'Fallon', 'St. Joseph', 'St. Charles', 'Blue Springs'],
  },
  {
    name: 'Montana',
    code: 'MT',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City'],
  },
  {
    name: 'Nebraska',
    code: 'NE',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'North Platte', 'Columbus'],
  },
  {
    name: 'Nevada',
    code: 'NV',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City'],
  },
  {
    name: 'New Hampshire',
    code: 'NH',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Manchester', 'Nashua', 'Concord', 'Dover', 'Rochester', 'Keene', 'Portsmouth', 'Laconia', 'Claremont', 'Lebanon'],
  },
  {
    name: 'New Jersey',
    code: 'NJ',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Lakewood', 'Edison', 'Woodbridge', 'Toms River', 'Hamilton', 'Trenton', 'Clifton', 'Camden'],
  },
  {
    name: 'New Mexico',
    code: 'NM',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Clovis', 'Hobbs', 'Alamogordo', 'Carlsbad'],
  },
  {
    name: 'New York',
    code: 'NY',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: [
      'New York City', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse',
      'Albany', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica',
      'White Plains', 'Hempstead', 'Troy', 'Niagara Falls', 'Binghamton'
    ],
  },
  {
    name: 'North Carolina',
    code: 'NC',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Asheville', 'Gastonia'],
  },
  {
    name: 'North Dakota',
    code: 'ND',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Williston', 'Dickinson', 'Mandan', 'Jamestown', 'Wahpeton'],
  },
  {
    name: 'Ohio',
    code: 'OH',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Lorain', 'Hamilton', 'Youngstown', 'Springfield'],
  },
  {
    name: 'Oklahoma',
    code: 'OK',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton', 'Moore', 'Midwest City', 'Enid', 'Stillwater'],
  },
  {
    name: 'Oregon',
    code: 'OR',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Portland', 'Eugene', 'Salem', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard'],
  },
  {
    name: 'Pennsylvania',
    code: 'PA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Erie', 'Upper Darby', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Wilkes-Barre'],
  },
  {
    name: 'Rhode Island',
    code: 'RI',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Providence', 'Cranston', 'Warwick', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown'],
  },
  {
    name: 'South Carolina',
    code: 'SC',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Charleston', 'Columbia', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville', 'Goose Creek', 'Sumter', 'Florence', 'Spartanburg'],
  },
  {
    name: 'South Dakota',
    code: 'SD',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Spearfish'],
  },
  {
    name: 'Tennessee',
    code: 'TN',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Johnson City', 'Jackson', 'Hendersonville'],
  },
  {
    name: 'Texas',
    code: 'TX',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: [
      'Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth',
      'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Lubbock',
      'Laredo', 'Irving', 'Garland', 'Frisco', 'McKinney',
      'Amarillo', 'Grand Prairie', 'Brownsville', 'Killeen', 'Pasadena',
      'Mesquite', 'McAllen', 'Denton', 'Waco', 'Carrollton',
      'Round Rock', 'Abilene', 'Pearland', 'Richardson', 'Sugar Land'
    ],
  },
  {
    name: 'Utah',
    code: 'UT',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'Ogden', 'St. George', 'Layton', 'South Jordan'],
  },
  {
    name: 'Vermont',
    code: 'VT',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier', 'Winooski', 'St. Albans', 'Newport', 'Vergennes'],
  },
  {
    name: 'Virginia',
    code: 'VA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Virginia Beach', 'Chesapeake', 'Norfolk', 'Arlington', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk', 'Lynchburg'],
  },
  {
    name: 'Washington',
    code: 'WA',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Spokane Valley', 'Federal Way', 'Yakima', 'Bellingham'],
  },
  {
    name: 'West Virginia',
    code: 'WV',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg'],
  },
  {
    name: 'Wisconsin',
    code: 'WI',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire', 'Oshkosh', 'Janesville', 'West Allis', 'La Crosse'],
  },
  {
    name: 'Wyoming',
    code: 'WY',
    type: 'State',
    countryCode: 'US',
    country: 'USA',
    cities: ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Riverton', 'Jackson'],
  },
];

// ==========================================
// CANADA: 10 PROVINCES + 3 TERRITORIES
// ==========================================
export const CANADA_PROVINCES_AND_TERRITORIES: StateRegion[] = [
  // 10 Provinces
  {
    name: 'Alberta',
    code: 'AB',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'St. Albert', 'Medicine Hat', 'Grande Prairie', 'Airdrie', 'Spruce Grove', 'Leduc'],
  },
  {
    name: 'British Columbia',
    code: 'BC',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Vancouver', 'Victoria', 'Surrey', 'Burnaby', 'Richmond', 'Abbotsford', 'Coquitlam', 'Kelowna', 'Langley', 'Saanich', 'Delta', 'Kamloops', 'Nanaimo'],
  },
  {
    name: 'Manitoba',
    code: 'MB',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Winnipeg', 'Brandon', 'Steinbach', 'Thompson', 'Portage la Prairie', 'Winkler', 'Selkirk', 'Morden', 'Dauphin'],
  },
  {
    name: 'New Brunswick',
    code: 'NB',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Moncton', 'Saint John', 'Fredericton', 'Dieppe', 'Miramichi', 'Edmundston', 'Bathurst', 'Campbellton'],
  },
  {
    name: 'Newfoundland and Labrador',
    code: 'NL',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['St. John\'s', 'Conception Bay South', 'Mount Pearl', 'Paradise', 'Corner Brook', 'Grand Falls-Windsor', 'Gander'],
  },
  {
    name: 'Nova Scotia',
    code: 'NS',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Halifax', 'Dartmouth', 'Sydney', 'Truro', 'New Glasgow', 'Glace Bay', 'Kentville', 'Amherst', 'Bridgewater'],
  },
  {
    name: 'Ontario',
    code: 'ON',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: [
      'Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton',
      'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor',
      'Richmond Hill', 'Oakville', 'Burlington', 'Greater Sudbury', 'Oshawa',
      'Barrie', 'St. Catharines', 'Cambridge', 'Kingston', 'Guelph',
      'Thunder Bay', 'Waterloo', 'Brantford', 'Pickering', 'Niagara Falls'
    ],
  },
  {
    name: 'Prince Edward Island',
    code: 'PE',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Charlottetown', 'Summerside', 'Stratford', 'Cornwall', 'Montague'],
  },
  {
    name: 'Quebec',
    code: 'QC',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Saguenay', 'Levis', 'Trois-Rivieres', 'Terrebonne', 'Saint-Jean-sur-Richelieu'],
  },
  {
    name: 'Saskatchewan',
    code: 'SK',
    type: 'Province',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Saskatoon', 'Regina', 'Prince Albert', 'Moose Jaw', 'Swift Current', 'Yorkton', 'North Battleford', 'Lloydminster'],
  },
  // 3 Territories
  {
    name: 'Northwest Territories',
    code: 'NT',
    type: 'Territory',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Yellowknife', 'Inuvik', 'Hay River', 'Fort Smith'],
  },
  {
    name: 'Nunavut',
    code: 'NU',
    type: 'Territory',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Iqaluit', 'Rankin Inlet', 'Arviat', 'Baker Lake'],
  },
  {
    name: 'Yukon',
    code: 'YT',
    type: 'Territory',
    countryCode: 'CA',
    country: 'Canada',
    cities: ['Whitehorse', 'Dawson City', 'Watson Lake', 'Haines Junction'],
  },
];

// ==========================================
// INDIA: 28 STATES + 8 UNION TERRITORIES
// ==========================================
export const INDIA_REGIONS: StateRegion[] = INDIAN_STATES_AND_UTS.map((s) => ({
  name: s.name,
  code: s.name.slice(0, 2).toUpperCase(),
  type: s.type,
  countryCode: 'IN',
  country: 'India',
  cities: s.cities,
}));

// ==========================================
// CANONICAL COUNTRIES
// ==========================================
export const SUPPORTED_COUNTRIES: CountryInfo[] = [
  {
    id: 'India',
    name: 'India',
    code: 'IN',
    subdivisionLabel: 'State / UT',
    regions: INDIA_REGIONS,
  },
  {
    id: 'USA',
    name: 'United States',
    code: 'US',
    subdivisionLabel: 'State',
    regions: USA_STATES,
  },
  {
    id: 'Canada',
    name: 'Canada',
    code: 'CA',
    subdivisionLabel: 'Province / Territory',
    regions: CANADA_PROVINCES_AND_TERRITORIES,
  },
];

export function getSupportedCountries(): CountryInfo[] {
  return SUPPORTED_COUNTRIES;
}

/**
 * Normalizes input country string into canonical 'USA' | 'Canada' | 'India'.
 */
export function normalizeCountry(countryStr?: string): 'USA' | 'Canada' | 'India' | null {
  if (!countryStr) return null;
  const clean = countryStr.trim().toLowerCase();
  if (['usa', 'us', 'united states', 'united states of america'].includes(clean)) {
    return 'USA';
  }
  if (['canada', 'ca'].includes(clean)) {
    return 'Canada';
  }
  if (['india', 'in', 'bharat'].includes(clean)) {
    return 'India';
  }
  return null;
}

export function getRegionsForCountry(country: string): StateRegion[] {
  const norm = normalizeCountry(country);
  if (!norm) return [];
  const found = SUPPORTED_COUNTRIES.find((c) => c.id === norm);
  return found ? found.regions : [];
}

export function getCitiesForRegion(country: string, regionNameOrCode: string): string[] {
  const regions = getRegionsForCountry(country);
  const clean = regionNameOrCode.trim().toLowerCase();
  const region = regions.find(
    (r) => r.name.toLowerCase() === clean || r.code.toLowerCase() === clean
  );
  return region ? region.cities : [];
}

export interface LocationValidationResult {
  valid: boolean;
  error?: string;
  country: 'USA' | 'Canada' | 'India';
  countryCode: 'US' | 'CA' | 'IN';
  matchedState: string;
  stateCode?: string;
  matchedCity?: string;
}

/**
 * Comprehensive cross-country and cross-state location validator.
 * Ensures:
 * 1. Country is valid (India, USA, Canada).
 * 2. State/Province belongs to the selected country (no cross-country pollution).
 * 3. City is validated without blocking Google Places discovery of unlisted municipalities.
 */
export function validateLocation(
  countryInput?: string,
  stateInput?: string,
  cityInput?: string
): LocationValidationResult {
  const country = normalizeCountry(countryInput || 'India');
  if (!country) {
    return {
      valid: false,
      error: `Unsupported country: "${countryInput}". LeadPilot currently supports India, USA, and Canada.`,
      country: 'India',
      countryCode: 'IN',
      matchedState: '',
    };
  }

  const countryInfo = SUPPORTED_COUNTRIES.find((c) => c.id === country)!;
  if (!stateInput || !stateInput.trim()) {
    return {
      valid: false,
      error: `Please select a ${countryInfo.subdivisionLabel} for ${countryInfo.name}.`,
      country,
      countryCode: countryInfo.code,
      matchedState: '',
    };
  }

  const cleanState = stateInput.trim().toLowerCase();

  // Find region in selected country
  const region = countryInfo.regions.find(
    (r) => r.name.toLowerCase() === cleanState || r.code.toLowerCase() === cleanState
  );

  if (!region) {
    // Check if the user selected a region belonging to a different country
    for (const otherCountry of SUPPORTED_COUNTRIES) {
      if (otherCountry.id === country) continue;
      const foundInOther = otherCountry.regions.find(
        (r) => r.name.toLowerCase() === cleanState || r.code.toLowerCase() === cleanState
      );
      if (foundInOther) {
        return {
          valid: false,
          error: `Cross-country mismatch: "${foundInOther.name}" is a ${foundInOther.type} in ${otherCountry.name}, not ${countryInfo.name}.`,
          country,
          countryCode: countryInfo.code,
          matchedState: '',
        };
      }
    }

    return {
      valid: false,
      error: `Invalid ${countryInfo.subdivisionLabel} "${stateInput}" for ${countryInfo.name}. Please select a valid region.`,
      country,
      countryCode: countryInfo.code,
      matchedState: '',
    };
  }

  // City validation
  if (cityInput && cityInput.trim() && cityInput.toLowerCase() !== 'all cities in this state' && cityInput.toLowerCase() !== 'all cities in this province') {
    const rawClean = cityInput.trim();
    const cleanCity = (country === 'India' && COMMON_CITY_ALIASES[rawClean.toLowerCase()]) || rawClean;

    const cityMatch = region.cities.find(
      (c) =>
        c.toLowerCase() === rawClean.toLowerCase() ||
        c.toLowerCase() === cleanCity.toLowerCase() ||
        c.toLowerCase().startsWith(cleanCity.toLowerCase()) ||
        cleanCity.toLowerCase().startsWith(c.toLowerCase())
    );

    if (!cityMatch) {
      // Check if this city belongs to another state in the same country
      const otherRegion = countryInfo.regions.find(
        (r) =>
          r.name.toLowerCase() !== region.name.toLowerCase() &&
          r.cities.some(
            (c) =>
              c.toLowerCase() === rawClean.toLowerCase() ||
              c.toLowerCase() === cleanCity.toLowerCase()
          )
      );

      if (otherRegion) {
        return {
          valid: false,
          error: `Location mismatch: City "${rawClean}" belongs to "${otherRegion.name}", not "${region.name}". Please select the correct ${countryInfo.subdivisionLabel.toLowerCase()}.`,
          country,
          countryCode: countryInfo.code,
          matchedState: region.name,
          stateCode: region.code,
        };
      }

      // Resolves unlisted city/locality via provider query while retaining valid region
      return {
        valid: true,
        country,
        countryCode: countryInfo.code,
        matchedState: region.name,
        stateCode: region.code,
        matchedCity: rawClean,
      };
    }

    return {
      valid: true,
      country,
      countryCode: countryInfo.code,
      matchedState: region.name,
      stateCode: region.code,
      matchedCity: cityMatch,
    };
  }

  return {
    valid: true,
    country,
    countryCode: countryInfo.code,
    matchedState: region.name,
    stateCode: region.code,
  };
}
