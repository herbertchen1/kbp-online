/*!
 * KBPOnline
 * Author: Arun Chaganty, Ashwin Paranjape
 * Licensed under the MIT license
 */

define(['jquery'], function ($) {
    var CheckEntityLinkWidget = function(elem){
        this.elem = elem;
    };
    CheckEntityLinkWidget.prototype.init = function(mention, cb){
        this.mention = mention;
        this.canonicalMention = this.mention.entity.mentions[0];
        this.cb = cb;

        //Check if canonical mention is the same as this mention --
        // should already be checked!
        if (this.mention.span[0] == this.canonicalMention.span[0] && this.mention.span[1] == this.canonicalMention.span[1]){
            this.done(true);
            return;
        }

        this.elem.find("#relation-options").empty(); // Clear.
        this.elem.find("#relation-option-preview").empty(); // Clear.
        this.elem.find("#relation-examples").empty();
        var yesDiv = this.makeRelnOption(0, "Yes", "fa-check", "DarkGreen");
        var noDiv = this.makeRelnOption(1, "No", "fa-times", "coral");
        if (this.mention.canonicalCorrect !== null && this.mention.canonicalCorrect === true) yesDiv.addClass("btn-primary"); 
        if (this.mention.canonicalCorrect !== null && this.mention.canonicalCorrect === false) noDiv.addClass("btn-primary"); 
        this.elem.find("#relation-options").append(yesDiv);
        this.elem.find("#relation-options").append(noDiv);
        this.updateText(this.renderTemplate(this.mention));

        this.canonicalMention.tokens.forEach(function(t) {$(t).addClass("canonical highlight");});
        $(this.canonicalMention.elem).parent().addClass("highlight");
    };
    CheckEntityLinkWidget.prototype.updateText = function(previewText) {
        var div = this.elem.find("#relation-option-preview");
        div.html(previewText || "");
    };
    CheckEntityLinkWidget.prototype.makeRelnOption = function(id, text, icon, color) {
        var self = this;
        var div = $("#relation-option").clone();
        div.html(div.html().replace("{short}", text));
        div.find('.icon').removeClass('hidden').addClass(icon).css('color', color);
        div.attr("id", "relation-option-" + id);
  
        div.on("click.kbpo.entityLinkWidget", function(evt) {
            var ret = (text == "Yes") ? true : false;
            return self.done(ret);
        });

        return div;
    };

    // The widget selection is done -- send back results.
    CheckEntityLinkWidget.prototype.done = function(correctlyLinked) {
        var self = this;
        this.mention.entity.canonicalCorrect = correctlyLinked;

        if (this.cb) {
            return this.cb(correctlyLinked);
        } else {
            console.log("[Warning] Relation chosen but no callback", chosen_reln);
            return true;
        }
    };

    CheckEntityLinkWidget.prototype.renderTemplate = function(mention) {
        var template = "In the sentence you just read (shown below) does "+$('#mention-'+mention.id)[0].outerHTML+" refer to the <span class='canonical'>{canonical}</span> highlighted above?" + $('#sentence-'+mention.sentenceIdx).clone().addClass('highlight')[0].outerHTML;
        return template
            .replace("{mention}", mention.gloss)
            .replace("{canonical}", mention.entity.gloss);
    };

    return CheckEntityLinkWidget;
});
