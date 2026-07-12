// content/logger.js

const Logger = {

    prefix: "%c[OSM Reward Handler]",

    styles: {
        info: "color:#3498db;font-weight:bold;",
        success: "color:#2ecc71;font-weight:bold;",
        warning: "color:#f39c12;font-weight:bold;",
        error: "color:#e74c3c;font-weight:bold;",
        debug: "color:#9b59b6;font-weight:bold;"
    },

    info(message, ...args) {
        console.log(this.prefix, this.styles.info, message, ...args);
    },

    success(message, ...args) {
        console.log(this.prefix, this.styles.success, message, ...args);
    },

    warning(message, ...args) {
        console.warn(this.prefix, this.styles.warning, message, ...args);
    },

    error(message, ...args) {
        console.error(this.prefix, this.styles.error, message, ...args);
    },

    debug(message, ...args) {
        console.debug(this.prefix, this.styles.debug, message, ...args);
    }

};