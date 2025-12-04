/**
 * Weather API Module
 * Queries the Open-Meteo weather forecast API for current weather conditions
 * 
 * Usage:
 *   weather.getCurrent(latitude, longitude).then(data => {
 *       console.log('Temperature:', data.temperature);
 *       console.log('Precipitation:', data.precipitation);
 *       console.log('Rain:', data.rain);
 *       console.log('Snow:', data.snowfall);
 *   }).catch(err => console.error('Weather API error:', err));
 */

const weather = (function() {
    // Base URL for Open-Meteo API
    const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

    /**
     * Fetch current weather data for a given location
     * @param {number} latitude - WGS84 latitude coordinate
     * @param {number} longitude - WGS84 longitude coordinate
     * @param {object} options - Optional configuration
     * @param {string} options.temperatureUnit - 'celsius' (default) or 'fahrenheit'
     * @param {string} options.precipitationUnit - 'mm' (default) or 'inch'
     * @param {string} options.timezone - Timezone name (e.g., 'auto', 'America/New_York'); defaults to 'GMT'
     * @returns {Promise<object>} Resolved with current weather object containing:
     *   - temperature: Current temperature (in specified unit)
     *   - precipitationProbability: % chance of precipitation
     *   - precipitation: Total precipitation (mm or inch)
     *   - rain: Rain amount from weather systems (mm or inch)
     *   - showers: Shower precipitation (mm or inch)
     *   - snowfall: Snowfall amount (cm or inch)
     *   - weatherCode: WMO weather code (see interpretWeatherCode)
     *   - cloudCover: Cloud cover percentage (0-100%)
     *   - time: ISO8601 timestamp of observation
     */
    function getCurrent(latitude, longitude, options = {}) {
        const tempUnit = options.temperatureUnit || 'celsius';
        const precipUnit = options.precipitationUnit || 'mm';
        const tz = options.timezone || 'GMT';

        // Build query parameters for current weather
        const params = new URLSearchParams({
            latitude: latitude,
            longitude: longitude,
            current: [
                'temperature_2m',
                'relative_humidity_2m',
                'precipitation',
                'rain',
                'showers',
                'snowfall',
                'weather_code',
                'cloud_cover'
            ].join(','),
            temperature_unit: tempUnit,
            precipitation_unit: precipUnit,
            timezone: tz
        });

        const url = `${BASE_URL}?${params.toString()}`;

        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Weather API error: HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.error) {
                    throw new Error(`Weather API error: ${data.reason}`);
                }
                // Normalize the response
                const current = data.current || {};
                return {
                    temperature: current.temperature_2m,
                    humidity: current.relative_humidity_2m,
                    precipitation: current.precipitation,
                    rain: current.rain,
                    showers: current.showers,
                    snowfall: current.snowfall,
                    weatherCode: current.weather_code,
                    cloudCover: current.cloud_cover,
                    time: current.time,
                    // Include units for context
                    temperatureUnit: data.current_units?.temperature_2m || '°C',
                    precipitationUnit: data.current_units?.precipitation || 'mm',
                    // Include location info
                    latitude: data.latitude,
                    longitude: data.longitude,
                    timezone: data.timezone,
                    elevationMeters: data.elevation
                };
            });
    }

    /**
     * Interpret WMO weather code to human-readable description
     * @param {number} code - WMO weather interpretation code
     * @returns {string} Description of weather condition
     */
    function interpretWeatherCode(code) {
        const codes = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Foggy',
            48: 'Depositing rime fog',
            51: 'Light drizzle',
            53: 'Moderate drizzle',
            55: 'Dense drizzle',
            56: 'Light freezing drizzle',
            57: 'Dense freezing drizzle',
            61: 'Slight rain',
            63: 'Moderate rain',
            65: 'Heavy rain',
            66: 'Light freezing rain',
            67: 'Heavy freezing rain',
            71: 'Slight snow',
            73: 'Moderate snow',
            75: 'Heavy snow',
            77: 'Snow grains',
            80: 'Slight rain showers',
            81: 'Moderate rain showers',
            82: 'Violent rain showers',
            85: 'Slight snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm with slight hail',
            99: 'Thunderstorm with heavy hail'
        };
        return codes[code] || 'Unknown weather';
    }

    /**
     * Determine if current weather includes precipitation
     * @param {object} weatherData - Object returned from getCurrent()
     * @returns {boolean} True if any form of precipitation is occurring
     */
    function hasPrecipitation(weatherData) {
        if (!weatherData) return false;
        return (weatherData.precipitation || 0) > 0 ||
               (weatherData.rain || 0) > 0 ||
               (weatherData.showers || 0) > 0 ||
               (weatherData.snowfall || 0) > 0;
    }

    /**
     * Determine if current weather is snowing
     * @param {object} weatherData - Object returned from getCurrent()
     * @returns {boolean} True if snowfall is occurring or weather code indicates snow
     */
    function isSnowing(weatherData) {
        if (!weatherData) return false;
        if ((weatherData.snowfall || 0) > 0) return true;
        
        const code = weatherData.weatherCode;
        // WMO codes for snow: 71-77, 85-86
        return code && ((code >= 71 && code <= 77) || (code >= 85 && code <= 86));
    }

    /**
     * Determine if current weather is raining
     * @param {object} weatherData - Object returned from getCurrent()
     * @returns {boolean} True if rain is occurring or weather code indicates rain
     */
    function isRaining(weatherData) {
        if (!weatherData) return false;
        if ((weatherData.rain || 0) > 0 || (weatherData.showers || 0) > 0) return true;
        
        const code = weatherData.weatherCode;
        // WMO codes for rain: 51-67, 80-82, 95-99
        return code && (
            (code >= 51 && code <= 67) ||
            (code >= 80 && code <= 82) ||
            (code >= 95 && code <= 99)
        );
    }

    // Public API
    return {
        getCurrent,
        interpretWeatherCode,
        hasPrecipitation,
        isSnowing,
        isRaining
    };
})();
