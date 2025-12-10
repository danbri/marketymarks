module.exports = function(eleventyConfig) {
  // Copy static assets
  eleventyConfig.addPassthroughCopy("content/assets");

  // Watch for changes in content
  eleventyConfig.addWatchTarget("content/");

  return {
    dir: {
      input: "content",
      output: "www",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html"]
  };
};
