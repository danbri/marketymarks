module.exports = function(eleventyConfig) {
  // Copy static assets
  eleventyConfig.addPassthroughCopy("content/assets");
  eleventyConfig.addPassthroughCopy({ "content/CNAME": "CNAME" });
  // DPP checker: the EC's files (copied unchanged) and the checker module
  eleventyConfig.addPassthroughCopy("content/dpp/ec");
  eleventyConfig.addPassthroughCopy("content/dpp/lib");
  eleventyConfig.addPassthroughCopy("content/dpp/components");
  eleventyConfig.addPassthroughCopy("content/dpp/demo");
  eleventyConfig.addPassthroughCopy("content/dpp/gba");
  eleventyConfig.addPassthroughCopy("content/dpp/vc");

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
