'use strict';
// These variables create the connection to the dependencies.
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

const app = express();

// Allows us to use the .env file
require('dotenv').config();

// Setup database by creating a client instance, pointing it at our database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();

//Error handling for database
client.on('error', err => console.error(err));
// Tells express to use 'cors' for cross-origin resource sharing
app.use(cors());

// Empty the contents of a table
function deleteByLocationId(table, city) {
  const SQL = `DELETE from ${table} WHERE location_id=${city};`;
  return client.query(SQL);
}


// assigns the PORT variable to equal the port declared in the .env file for our local server.  It also allows heroku to assign it's own port number.
const PORT = process.env.PORT;

// When the user submits the form, the following app.get() will call the correct helper function to retrieve the API information.
app.get('/location', getLocation); //google API
// app.get('/weather', getWeather); //darkskies API
// app.get('/yelp', getRestaurants); // yelp API
// app.get('/movies', getMovies); // the movie database API

// Tells the server to start listening to the PORT, and console.logs to tell us it's on.
app.listen(PORT, () => console.log(`LAB-08 - Listening on ${PORT}`));

// CONSTRUCTOR FUNCTIONS START HERE //

// Contructor function for Google API
function LocationResult(search, location) {
  this.search_query = search;
  this.formatted_query = location.body.results[0].formatted_address;
  this.latitude = location.body.results[0].geometry.location.lat;
  this.longitude = location.body.results[0].geometry.location.lng;
}

LocationResult.prototype = {
  save: function () {
    const SQL = `INSERT INTO ${this.tableName} (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4);`;
    const values = [this.search_query, this.formatted_query, this.latitude, this.longitude];

    client.query(SQL, values);
  }
};

// Constructor function for Darksky API
function WeatherResult(weather) {
  this.time = new Date(weather.time * 1000).toString().slice(0, 15);
  this.forecast = weather.summary;
  this.created_at = Date.now();
}

WeatherResult.prototype = {
  save: function (location_id) {
    const SQL = `INSERT INTO ${this.tableName} (forecast, time, location_id) VALUES ($1, $2, $3, $4);`;
    const values = [this.forecast, this.time, this.created_at, location_id];

    client.query(SQL, values);
  }
};

// Constructor function for Yelp API
function RestaurantResult(restaurant) {
  this.name = restaurant.name;
  this.image_url = restaurant.image_url;
  this.price = restaurant.price;
  this.rating = restaurant.rating;
  this.url = restaurant.url;
  this.created_at = Date.now();
}

RestaurantResult.prototype = {
  save: function (location_id) {
    const SQL = `INSERT INTO ${this.tableName} (name,image_url,price,rating,url,created_at,location_id) VALUES ($1, $2, $3, $4, $5, $6);`;
    const values = [
      this.name,
      this.image_url,
      this.price,
      this.rating,
      this.url,
      this.created_at,
      location_id
    ];

    client.query(SQL, values);
  }
};

//Constructor function for The Movie Database API
// function MovieResults(movie) {
//   this.title = movie.title;
//   this.overview = movie.overview;
//   this.average_votes = movie.vote_average;
//   this.total_votes = movie.vote_count;
//   this.image_url = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
//   this.popularity = movie.popularity;
//   this.released_on = movie.release_date;
//   this.created_at = Date.now();
// }

// MovieResults.prototype = {
//   save: function (location_id) {
//     const SQL = `INSERT INTO ${this.tableName} (title, overview, average_votes, total_votes, image_url, popularity, relased_on, created_at, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`;
//     const values = [
//       this.title,
//       this.overview,
//       this.average_votes,
//       this.total_votes,
//       this.image_url,
//       this.popularity,
//       this.release_on,
//       this.created_at,
//       location_id
//     ];

//     client.query(SQL, values);
//   }
// };

// Define table names, lookup, and deleteByLoaction for each process
LocationResult.tablename = 'locations';
LocationResult.lookup = lookup;

WeatherResult.tableName = 'weathers';
WeatherResult.lookup = lookup;
WeatherResult.deleteByLocationId = deleteByLocationId;

RestaurantResult.tableName = 'restaurants';
RestaurantResult.lookup = lookup;
RestaurantResult.deleteByLocationId = deleteByLocationId;

// MovieResult.tableName = 'movies';
// MovieResult.lookup = lookup;
// MovieResult.deleteByLocationId = deleteByLocationId

// HELPER FUNCTIONS START HERE
// Generic lookup helper function
function lookup(options, location) {
  const SQL = `SELECT * FROM ${options.tableName} WHERE ${location}=$1;`;
  const values = [options.location];

  client
    .query(SQL, values)
    .then(result => {
      if (result.rowCount > 0) {
        options.cacheHit(result.rows);
      } else {
        options.cacheMiss();
      }
    })
    .catch(error => processError(error));
}

// Google helper function refactored prior to lab start.

function getLocation(request, response) {
  console.log('checking for data now...');
  LocationResult.lookup({
    tablename: LocationResult.tablename,
    cacheMiss: function () {
      console.log('Getting your data from the GOOGLES');
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GOOGLE_API_KEY}`;

      superagent
        .get(url)
        .then(location => {
          const foundLocation = new LocationResult(request.query.data, location);
          foundLocation.save();
          response.send(foundLocation);
        })
        .catch(error => processError(error, response));
    }
  }, 'id')
}

// Weather helper function
function getWeather(request, response) {
  WeatherResult.lookup({ //This invokes the generic lookup function
    tableName: WeatherResult.tableName,

    cacheMiss: function () {
      const url = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

      superagent
        .get(url)
        .then(result => {
          const weatherSummary = result.body.daily.data.map(day => {
            const dailySumary = new WeatherResult(day);
            dailySumary.save(request.query.data.id);
            return dailySumary;
          });
          response.send(weatherSummary);
        })
        .catch(error => processError(error, response));
    },

    cacheHit: function (resultsArray) {
      console.log('CacheHit');
      let ageOfData = (Date.now() - resultsArray[0].created_at) / (1000 * 60);

      if (ageOfData > 30) {
        console.log('Data is OLD!!!!');
        deleteByLocationId(
          WeatherResult.tableName,
          request.query.data.id
        );
      } else {
        console.log('Data is Current');
        response.send(resultsArray);
      }
    }
  }, 'location_id');
}

// Restraurant helper function
function getRestaurants(request, response) {
  RestaurantResult.lookup({
    tableName: RestaurantResult.tablename,

    cacheMiss: function () {

      const url = `https://api.yelp.com/v3/businesses/search?location=${request.query.data.search_query}`;
      console.log('checking for data');
      superagent
        .get(url)
        .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
        .then(result => {
          const yelpSummary = result.body.businesses.map(restaurant => {
            const eachRestaurant = new RestaurantResult(restaurant);
            eachRestaurant.save(request.query.data.id);
            return eachRestaurant;
          });
          response.send(yelpSummary);
        })
        .catch(error => processError(error, response));
    },

    cacheHit: function (resultsArray) {
      console.log('CacheHit');
      let ageOfData = (Date.now() - resultsArray[0].created_at) / (1000 * 60);

      if (ageOfData > 30) {
        console.log('Data is OLD!!!!');
        deleteByLocationId(
          RestaurantResult.tableName,
          request.query.data.id
        );
      } else {
        console.log('Data is Current');
        response.send(resultsArray);
      }
    }
  });
}

// //Movies helper function
// function getMovies(request, response) {
//   const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_APIv3_KEY}&query=${request.query.data.search_query}`;
//   return superagent
//     .get(url)
//     .then(result => {
//       const movieSummary = result.body.results.map(movie => {
//         const eachMovie = new MovieResults(movie);
//         eachMovie.save(request.query.data.id);
//         return eachMovie;
//       });
//       response.send(movieSummary);
//     })
//     .catch(error => processError(error, response));
// }

// Error handeling helper function
function processError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}
