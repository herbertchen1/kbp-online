/*
 * KBP online.
 * Arun Chaganty <arunchaganty@gmail.com>
 */
/**
 * The document object -- handles the storage and representation of
 * sentences.
 *
 * @elemId - DOM element that the document is rooted at.
 */
var DocWidget = function(elem) {
  console.assert(elem);
  this.elem = $(elem);
};

DocWidget.prototype.load = function(doc) {
  this.doc = doc;
  this.insertIntoDOM(doc);
  this.attachHandlers();
};

DocWidget.prototype.insertIntoDOM = function(doc) {
  // Load every sentence into the DOM.
  for (var i = 0; i < doc.sentences.length; i++) {
    sentence = doc.sentences[i];
    var span = $("<span>", {'class': 'sentence', 'id': 'sentence-' + i});
    span[0].sentence = sentence;
    span[0].sentenceIdx = i;

    for (var j = 0; j < sentence.length; j++) {
      var token = sentence[j];
      var tokenSpan = $("<span>", {'class': 'token', 'id': 'token-' + i + '-' + j})
                   .text(token.word);
      tokenSpan[0].token = token;
      tokenSpan[0].sentenceIdx = i;
      tokenSpan[0].tokenIdx = j;

      if (j > 0 && sentence[j].doc_char_begin > sentence[j-1].doc_char_end) {
        tokenSpan.html('&nbsp;' + tokenSpan.text());
      }
      span.append(tokenSpan);
    }
    this.elem.append(span);
  };
  //if (doc["mentions"]) {
  //  this.setMentions(doc["mentions"]);
  //}
};

DocWidget.prototype.setSuggestions = function(mentions) {
  var self = this;
  mentions.forEach(function(m) {
    m.tokens = self.getTokens(m.doc_char_begin, m.doc_char_end);
    m.tokens.forEach(function(t) {
      $(t).addClass("suggestion");
      t.suggestedMention = m;
    });
    $(m.tokens[m.tokens.length-1]).addClass("suggestion-end");
  });
};

DocWidget.prototype.setMentions = function(mentions) {
  var self = this;
  mentions.forEach(function(m) {
    m.tokens = self.getTokens(m.doc_char_begin, m.doc_char_end);
    m.tokens.forEach(function(t) {
      $(t).addClass("true-suggestion");
      t.mention = m;
    });
  });
};

DocWidget.prototype.getTokens = function(docCharBegin, docCharEnd) {
  return $('span.token').filter(function(_, t) {
    if (t.token.doc_char_begin >= docCharBegin 
        && t.token.doc_char_end <= docCharEnd) {
    }
    return t.token.doc_char_begin >= docCharBegin 
        && t.token.doc_char_end <= docCharEnd
  }).get(); 
};

// Build mention.
DocWidget.prototype.buildMention = function(m) {
  m.tokens = this.getTokens(m.doc_char_begin, m.doc_char_end);
  m.tokens.forEach(function(t) {$(t).addClass("mention");});
  console.assert(m.tokens.length > 0);

  m.inRelation = false;
  m.sentenceIdx = m.tokens[0].sentenceIdx;
  return m;
}

DocWidget.prototype.highlightListeners = []
DocWidget.prototype.mouseEnterListeners = []
DocWidget.prototype.mouseLeaveListeners = []
DocWidget.prototype.clickListeners = []

DocWidget.prototype.isSentence = function(node) {
  return node.classList.contains("sentence");
}
DocWidget.prototype.isToken = function(node) {
  return node.classList.contains("token");
}
DocWidget.prototype.isMention = function(node) {
  return node.classList.contains("mention");
}

/**
 * Attaches handlers to the DOM elements in the document and forwards
 * events to the listeners.
 */
DocWidget.prototype.attachHandlers = function() {
  var self = this;

  // highlightListeners (a bit complicated because selection objects must
  // be handled.
  this.elem.on("mouseup.kbpo.docWidget", function(evt) { // Any selection in the document.
    var sel = document.getSelection();
    //if (sel.isCollapsed) return; // Collapsed => an empty selection.
    if (!self.elem[0].contains(sel.anchorNode)) return;
    if (sel.isCollapsed) {
      // This is a click event.
      var parents = $(sel.anchorNode).parentsUntil(".sentence");
      var startNode = parents[parents.length-1];

      console.assert(startNode && startNode.nodeName != "HTML");
      // startNode is either a token or a sentence.
      if (self.isToken(startNode)) {
        selectedTokens = [startNode];
        self.highlightListeners.forEach(function (listener) {listener(selectedTokens);});
      } else if (self.isMention(startNode)) {
        self.clickListeners.forEach(function (cb) {cb(startNode.mention);});
      } else {
        console.log("[Error] selected anchor node is not part of a sentence or a token", sel.anchorNode.parentNode);
        sel.collapseToEnd();
        return;
      }
      evt.stopPropagation();
    
      return; // Collapsed => an empty selection. 
    }

    // The selected elements are not even in the #document.
    if (!self.elem[0].contains(sel.anchorNode) || !self.elem[0].contains(sel.focusNode)) {
      sel.collapseToEnd();
      return;
    }

    // Handle the case that the node is an '&nbsp;' text.
    var startNode;
    if (self.isToken(sel.anchorNode.parentNode)) {
      startNode = sel.anchorNode.parentNode;
    } else if (self.isSentence(sel.anchorNode.parentNode)) {
      startNode = sel.anchorNode.nextSibling;
    } else {
      console.log("[Error] selected anchor node is not part of a sentence or a token");
      sel.collapseToEnd();
      return;
    }

    var endNode;
    if (self.isToken(sel.focusNode.parentNode)) {
      endNode = sel.focusNode.parentNode;
    } else if (self.isSentence(sel.focusNode.parentNode)) {
      endNode = sel.focusNode.previousSibling;
    } else {
      console.log("[Error] selected focus node is not part of a sentence or a token");
      sel.collapseToEnd();
      return;
    }

    // Make sure both startNode and endNode are part of the same sentence.
    if (startNode.parentNode != endNode.parentNode) {
      console.log("[Error] selected tokens cross sentence boundaries");
      sel.collapseToEnd();
      return;
    }

    // Make sure startNode appears before endNode.
    if (startNode != endNode && $(startNode).nextAll().filter(endNode).length === 0) {
      var tmpNode = endNode;
      endNode = startNode;
      startNode = tmpNode;
    } 
    console.assert(startNode == endNode || $(startNode).nextAll(endNode).length !== 0, "[Warning] start node does not preceed end node", startNode, endNode);

    // Create a selection object of the spans in between the start and
    // end nodes.
    var selectedTokens = [];
    while (startNode != endNode) {
      console.assert(startNode != null);
      if ($(startNode).hasClass('token')) {
        selectedTokens.push(startNode);
      }
      startNode = startNode.nextSibling;
    }
    if ($(startNode).hasClass('token')) {
      selectedTokens.push(startNode);
    }
    
    self.highlightListeners.forEach(function (listener) {listener(selectedTokens);});

    sel.collapseToEnd();
  });

  // mouseEnter
  // this.elem.find('span.token').on("mouseenter.kbpo.docWidget", function(evt) { // Any selection in the document.
  //   self.mouseEnterListeners.forEach(function (listener) {listener(this);});
  // });

  // // mouseLeave
  // this.elem.find('span.token').on("mouseleave.kbpo.docWidget", function(evt) { // Any selection in the document.
  //   self.mouseLeaveListeners.forEach(function (listener) {listener(this);});
  // });

  // clickListeners
  /*this.elem.find("span.token").on("click.kbpo.docWidget", function(evt) {
    console.log("span-click:", this);
    self.clickListeners.forEach(function (listener) {listener(this);});
  });*/
};

// Create a mention from a set of spans.
DocWidget.prototype.addMention = function(mention) {
  var self = this;
  $(mention.tokens).wrapAll($("<span class='mention' />").attr("id", "mention-"+mention.id));
  var elem = $(mention.tokens[0].parentNode)[0];
  // Create links between the mention and DOM elements.
  elem.mention = mention;
  mention.elem = elem;
  mention.tokens.forEach(function(t) {t.mention = mention});

  return this.updateMention(mention);
}
DocWidget.prototype.updateMention = function(mention) {
  var elem = $(mention.elem);

  // If we have type and entity information, populate.
  if (mention.entity && mention.entity.gloss) {
    if (elem.find(".link-marker").length == 0) elem.prepend($("<span class='link-marker' />"));
    elem.find(".link-marker")
      .html(mention.entity.gloss + "<sup>" + (mention.entity.idx ? mention.entity.idx : "") + "</sup>");
  } else {
    elem.find(".link-marker").remove();
  }
  if (mention.type) {
    elem.addClass(mention.type.name);
    if (elem.find(".type-marker").length == 0) 
      elem.append($("<span class='type-marker fa fa-fw' />"));
    elem.find('.type-marker')
      .attr("class", "type-marker fa fa-fw").addClass(mention.type.icon);
  } else {
    elem.find(".type-marker").remove();
  }
  return elem;
}


DocWidget.prototype.removeMention = function(mention) {
  var div = $(mention.tokens[0].parentNode);
  div.find(".link-marker").remove();
  div.find(".type-marker").remove();
  console.log(mention.tokens);
  for(var i=0; i<mention.tokens.length; i++){
        mention.tokens[i].mention = undefined;
  }
  $(mention.tokens).unwrap();
}

DocWidget.prototype.highlightMention = function(mention) {
  $(mention.elem).addClass("highlight");
}

DocWidget.prototype.unhighlightMention = function(mention) {
  $(mention.elem).removeClass("highlight");
}

DocWidget.prototype.selectMention = function(mention) {
  $(mention.elem).addClass("selected");
}

DocWidget.prototype.unselectMention = function(mention) {
  $(mention.elem).removeClass("selected");
}

function getCandidateRelations(mentionPair) {
  var candidates = [];
  RELATIONS.forEach(function (reln) {
    if (reln.isApplicable(mentionPair)) candidates.push(reln);
  });
  return candidates;
}
/*
 * The entity link widget takes a mention and verifies its link (to Wikipedia)
 */
var CheckWikiLinkWidget = function(elem){
    this.elem = elem;
};
CheckWikiLinkWidget.prototype.init = function(mention){
    this.mention = mention;
    this.entity = this.mention.entity;
    if (this.entity.linkVerification != undefined){
        this.done();
        return;
    }
    this.canonicalMention = this.entity.mentions[0];
    this.elem.find('#mention-gloss').text(this.mention.text());
    this.elem.find('#canonical-gloss').text(this.canonicalMention.text());

    var self = this;
    this.elem.find('#correct-wiki-link').on("click.kbpo.checkWikiLinkWidget", function(evt) {
        self.entity.linkCorrect = "Yes";
        self.done();
    });
    this.elem.find('#wrong-wiki-link').on("click.kbpo.checkWikiLinkWidget", function(evt) {
        self.entity.linkCorrect = "No";
        self.done();
    });

    this.elem.find('#mention-gloss').text(this.mention.text());
    //TODO: Make sure the wikilink is a valid wikipedia url

    //Do no ask for NIL clusters
    if(this.entity.link.substring(0, 3) == "NIL"){
        this.entity.linkCorrect = "NA";
        this.done();
        return;
    }
    $.ajax({
        url: 'https://en.wikipedia.org/w/api.php',
        data: { action: 'query', titles: this.entity.link, format: 'json',prop: 'extracts|pageimages' , exintro:"", pithumbsize: 150},
        dataType: 'jsonp'
    }).done(function(response) {
        var first = null;
        for(var ids in response.query.pages){
            first = response.query.pages[ids];
            break;
        }
        if (first != null){
            console.log(first.extract); 
            self.elem.find('#wiki-frame>div').html(first.extract);
            self.elem.find('#wiki-frame>h3>a').html(first.title);
            self.elem.find('#wiki-frame>h3>a').attr('href', "https://en.wikipedia.org/wiki/"+self.entity.link)
            if (first.thumbnail != undefined){
                self.elem.find('#wiki-frame>img').attr('src', first.thumbnail.source);
            }
        }else{
            this.entity.linkCorrect = "invalid_link";
            this.done();
            return
        }
    });

};
CheckWikiLinkWidget.prototype.done = function(){
    this.elem.find('mention-gloss').text("");
    this.elem.find('canonical-gloss').text("");
    this.elem.find('#wiki-frame>div').empty();
    this.elem.find('#wiki-frame>h3>a').empty();
    this.elem.find('#wiki-frame>h3>a').attr('href', "")
    this.elem.find('#wiki-frame>img').attr('src', "");
    this.elem.modal('hide');
    var self = this;
    this.elem.on('hidden.bs.modal', function (e) {
        self.cb();
    })
    
};
CheckWikiLinkWidget.prototype.show = function(){
  this.elem.modal('show');
};

/*
 * The entity link widget takes a mention and verifies its canonical mention
 */
var CheckEntityLinkWidget = function(elem){
    this.elem = elem;
    this.linkVerificationWidget = new CheckWikiLinkWidget($("#wiki-verification-modal"));
}
CheckEntityLinkWidget.prototype.init = function(mention, cb){
    this.mention = mention;
    this.canonicalMention = this.mention.entity.mentions[0];
    this.linkVerificationWidget.init(mention);
    this.cb = cb;
    //Check if canonical mention is the same as this mention
    if (this.mention.doc_char_begin == this.canonicalMention.doc_char_begin && this.mention.doc_char_end == this.canonicalMention.doc_char_end){
        this.done('Yes');
        return;
    }
    this.elem.find("#relation-options").empty(); // Clear.
    this.elem.find("#relation-option-preview").empty(); // Clear.
    this.elem.find("#relation-examples").empty();
    var yesDiv = this.makeRelnOption("Yes", "fa-check", "DarkGreen");
    var noDiv = this.makeRelnOption("No", "fa-times", "coral");
    if (this.mention.canonicalCorrect != null && this.mention.canonicalCorrect == "Yes") yesDiv.addClass("btn-primary"); 
    if (this.mention.canonicalCorrect != null && this.mention.canonicalCorrect == "No") noDiv.addClass("btn-primary"); 
    this.elem.find("#relation-options").append(yesDiv);
    this.elem.find("#relation-options").append(noDiv);
    this.updateText(this.renderTemplate(this.mention));

    centerOnMention(this.canonicalMention);
    //this.mention.tokens.forEach(function(t) {$(t).addClass("subject highlight");});
    this.canonicalMention.tokens.forEach(function(t) {$(t).addClass("canonical highlight");});
    $(this.canonicalMention.elem).parent().addClass("highlight");
}
CheckEntityLinkWidget.prototype.updateText = function(previewText) {
    var div = this.elem.find("#relation-option-preview");
    div.html(previewText || "");
}
CheckEntityLinkWidget.prototype.makeRelnOption = function(text, icon, color) {
  var self = this;
  var div = $("#relation-option-widget").clone();
  div.html(div.html().replace("{short}", text));
  div.find('.icon').removeClass('hidden').addClass(icon).css('color',  color);
  div.on("click.kbpo.checkEntityLinkWidget", function(evt) {
      self.done(text)
  });
  // Update widget text. 
  return div;
}

// The widget selection is done -- send back results.
CheckEntityLinkWidget.prototype.done = function(correctlyLinked) {
  // Clear the innards of the html.
  this.elem.find("#relation-options").empty();
  this.elem.find("#relation-option-preview").empty();
  this.elem.find("#relation-examples").empty();
  this.mention.entity.canonicalCorrect = correctlyLinked;
  var self = this;

  if (correctlyLinked == "Yes"){
      //Now verify wiki linking
      this.linkVerificationWidget.cb = function(){
          if (self.cb) {
            self.cb(correctlyLinked);
          } else {
            console.log("[Warning] Relation chosen but no callback", chosen_reln);
          }
      }
      this.linkVerificationWidget.show();

      //this.wikiLinkWidget
  }
  else{
      // Send a call back to the interface.
      if (this.cb) {
        this.cb(correctlyLinked);
      } else {
        console.log("[Warning] Relation chosen but no callback", chosen_reln);
      }
  }
}

CheckEntityLinkWidget.prototype.renderTemplate = function(mention) {
  var template = "In the sentence you just read (shown below) is <span class='subject'>{mention}</span> referring to <span class='canonical'>{canonical}</span> according to the highlighted sentence?" + $('#sentence-'+mention.sentenceIdx)[0].outerHTML;
  return template
    .replace("{mention}", mention.text())
    .replace("{canonical}", mention.entity.gloss);
}

/**
 * The relation widget is controlled by the RelationInterface. */
var RelationWidget = function(elem) {
  this.elem = elem;
  this.canonicalLinkWidget = new CheckEntityLinkWidget(elem);
  //this.wikiLinkWidget = CheckEntityLinkWidget(elem)
};

// initialize the interface using @mentionPair. On completion, call @cb.
RelationWidget.prototype.init = function(mentionPair, cb, linkVerify) {
  this.mentionPair = mentionPair;
  this.cb = cb;
  if(linkVerify != undefined){
    this.linkVerify = linkVerify;
  }else{
      this.linkVerify = false;
  }
  console.log("initializing relation widget for", mentionPair);

  this.relns = getCandidateRelations(mentionPair);
  this.elem.find("#relation-options").empty(); // Clear.
  this.elem.find("#relation-option-preview").empty(); // Clear.
  for (var i = 0; i < this.relns.length; i++) {
    var relnDiv = this.makeRelnOption(this.relns[i], i);
    // if this relation has already been selected, then show it in
    // a different color.
    if (this.mentionPair.relation != null && this.mentionPair.relation.name == this.relns[i].name) relnDiv.addClass("btn-primary"); 
    this.elem.find("#relation-options").append(relnDiv);

    if (this.relns[i].examples.length > 0) {
        var relnHelp = this.makeRelnHelp(this.relns[i], i);
        this.elem.find("#relation-examples").append(relnHelp);
    }
  }

  this.updateText(this.renderTemplate(this.mentionPair))
}

RelationWidget.prototype.updateText = function(previewText) {
  var div = this.elem.find("#relation-option-preview");
  div.html(previewText || "");
}

RelationWidget.prototype.makeRelnOption = function(reln, id) {
  var self = this;
  var div = $("#relation-option-widget").clone();
  div.html(div.html().replace("{short}", reln.short));
  if (reln.image !=""){
    div.find('img').removeClass('hidden').attr('src', 'images/relations/'+reln.image);
  }
  else if(reln.icon != ""){
    div.find('.icon').removeClass('hidden').addClass(reln.icon);
  }
  else{
    div.find('.icon').removeClass('hidden').addClass('fa-question-circle-o').css('color',  'coral');
  }
  div.attr("id", "relation-option-" + id);
  div.on("click.kbpo.relationWidget", function(evt) {
      if(self.linkVerify){
          self.canonicalLinkWidget.init(self.mentionPair.subject, function(){
            self.canonicalLinkWidget.init(self.mentionPair.object, function(){self.done(reln);});
      });
      }
      else{
        self.done(reln)
      }
  });
  // Update widget text. 
  console.log(self.mentionPair);
  div.on("mouseenter.kbpo.relationWidget", function(evt) {self.updateText(reln.renderTemplate(self.mentionPair), this.linkVerify)});
  div.on("mouseleave.kbpo.relationWidget", function(evt) {self.updateText(self.renderTemplate(self.mentionPair))});
  return div;
}

RelationWidget.prototype.makeRelnHelp = function(reln, id) {
  var elem = $("<li>");
  elem.html("<b>{}</b>".replace("{}", reln.short));
  var elems = $("<ul>");
  for (var i = 0; i < reln.examples.length; i++) {
      elems.append($("<li>").html(
            reln.examples[i]
            .replace("{", "<span class='subject'>") 
            .replace("}", "</span>") 
            .replace("[", "<span class='object'>") 
            .replace("]", "</span>") 
      ));
  }
  elem.append(elems);
  return elem;
}

RelationWidget.prototype.renderTemplate = function(mentionPair) {
  var template = "Please choose how <span class='subject'>{subject}</span> and <span class='object'>{object}</span> are related from the options below.";
  return template
    .replace("{subject}", mentionPair.subject.gloss)
    .replace("{object}", mentionPair.object.gloss);
}

// The widget selection is done -- send back results.
RelationWidget.prototype.done = function(chosen_reln) {
  // Clear the innards of the html.
  this.elem.find("#relation-options").empty();
  this.elem.find("#relation-option-preview").empty();
  this.elem.find("#relation-examples").empty();

  // Send a call back to the interface.
  if (this.cb) {
    this.cb(chosen_reln);
  } else {
    console.log("[Warning] Relation chosen but no callback", chosen_reln);
  }
}

/**
 * Stores actual relations and iterates through every mention pair in
 * the document, controlling various UI elements.
 */
var RelationInterface = function(docWidget, relnWidget, listWidget, verify) {
  var self = this;
  this.docWidget = docWidget; 
  this.relnWidget = relnWidget; 
  this.listWidget = listWidget; 
  if(verify != undefined){
    this.verify = verify;
  }else{
      this.verify = false;
  }
  

  this.listWidget.mouseEnterListeners.push(function(p) {self.highlightExistingMentionPair(p)});
  this.listWidget.mouseLeaveListeners.push(function(p) {self.unhighlightExistingMentionPair(p)});
  this.listWidget.clickListeners.push(function(p) {self.editExistingMentionPair(p)});

  this.docWidget.elem[0].scrollTop = 0;

  $("#done")[0].disabled = true;
  $("#back")[0].disabled = true;

  $("#back").on("click.kbpo.interface", function (evt) {
    self.editExistingMentionPair(self.mentionPairs[self.currentIndex-1]); 
    return false;
  });

  if (this.verify){
      $("#done").on("click.kbpo.interface", function (evt) {
          var relations = [];
          self.mentionPairs.forEach(function(e){
              relations.push({
                  "subject": (e.subject).toJSON(),
                  "relation": e.relation.name,
                  "object": (e.object).toJSON(),
              });
          });
          var data = JSON.stringify(relations);
          $("#relations-output").attr('value', data);
          alert($("#relations-output")[0].value);
          self.doneListeners.forEach(function(cb) {cb(data);});
          return false;
          //return true;
      });
  }
  else{
      $("#done").on("click.kbpo.interface", function (evt) {
          var relations = [];
          self.listWidget.relations().each(function(_, e){
              e = e.mentionPair;
              relations.push({
                  "subject": (e.subject).toJSON(),
                  "relation": e.relation.name,
                  "object": (e.object).toJSON(),
              });
          });
          var data = JSON.stringify(relations);
          $("#relations-output").attr('value', data);
          self.doneListeners.forEach(function(cb) {cb(data);});
          return false;
          //return true;
      });
  }
};

RelationInterface.prototype.doneListeners = [];

// Iterates through the mention pairs that need to be verified.
RelationInterface.prototype.runVerify = function(relations) {
    var self = this;
    this.mentionPairs = [];
    relations.forEach(function(rel, idx){
        rel.subject.tokens = self.docWidget.getTokens(rel.subject.doc_char_begin, rel.subject.doc_char_end);
        if(rel.subject.tokens.length >0){
            rel.subject = new Mention(rel.subject);
            self.docWidget.addMention(rel.subject);
        }
        //TODO: Create a mention and add entity 
        if (rel.subject.entity != undefined){
            rel.subject.entity['type'] = rel.subject['type'];
            rel.subject.entity.tokens = self.docWidget.getTokens(rel.subject.entity.doc_char_begin, rel.subject.entity.doc_char_end);
            var link = rel.subject.entity.link;
            var canonicalMention = new Mention(rel.subject.entity);
            self.docWidget.addMention(canonicalMention);
            rel.subject.entity = new Entity(canonicalMention);
            rel.subject.entity.link = link;
        }
        rel.object.tokens = self.docWidget.getTokens(rel.object.doc_char_begin, rel.object.doc_char_end);
        if(rel.object.tokens.length >0){
            rel.object = new Mention(rel.object);
            self.docWidget.addMention(rel.object);
            //TODO: Check if entities need to be added as well
        }
        //TODO: Create a mention and add entity 
        if (rel.object.entity != undefined){
            rel.object.entity['type'] = rel.object['type'];
            rel.object.entity.tokens = self.docWidget.getTokens(rel.object.entity.doc_char_begin, rel.object.entity.doc_char_end);
            var link = rel.object.entity.link;
            var canonicalMention = new Mention(rel.object.entity);
            self.docWidget.addMention(canonicalMention);
            rel.object.entity = new Entity(canonicalMention);
            rel.object.entity.link = link;
        }
        self.mentionPairs.push({'subject': rel.subject, 'object': rel.object, 'id': idx, 'relation': null});
    });
    this.currentIndex = -1;
    this.viewStack = [];
    this.next();
}
RelationInterface.prototype.run = function(mentions) {
  var self = this;
  this.mentions = [];

  mentions.forEach(function (m) {
    m.tokens = self.docWidget.getTokens(m.doc_char_begin, m.doc_char_end);
    if (m.tokens.length > 0) {
      m = new Mention(m);
      self.docWidget.addMention(m);
      self.mentions.push(m);
    }
  });
  this.mentionPairs = this.constructMentionPairs(this.mentions);

  this.currentIndex = -1;
  this.viewStack = []; // Used when changing relations.
  this.next();
}

function outOfSentenceLimit(m, n) {
  return Math.abs(m.sentenceIdx - n.sentenceIdx) > 1;
}

function isRelationCandidate(m, n) {
  if (m.gloss == n.gloss) return false;
  if (m.entity.link == n.entity.link) return false;
  if (m.type.name == "PER") {
    return true;
  } else if (m.type.name == "ORG") {
    return !(n.type.name == "PER") && !(n.type.name == "TITLE");
  } else { // All other mentions are not entities; can't be subjects.
    return false;
  }
}

function notDuplicated(pairs, m, n) {
  // Only need to look backwards through list until the sentence
  // limit
  console.log(pairs)
  for(var i = pairs.length-1; i >= 0; i--) {
    var m_ = pairs[i].subject;
    var n_ = pairs[i].object;

    if (outOfSentenceLimit(m, m_)
        || outOfSentenceLimit(m, n_)
        || outOfSentenceLimit(n, m_)
        || outOfSentenceLimit(n, n_)) break;
    if (m_ === n && n_ == m) return false;
  }
  return true;
}


// For every pair of mentions in a span of (2) sentences.
RelationInterface.prototype.constructMentionPairs = function(mentions) {
  var pairs = [];

  //var seenEntities = {}; // If you see two entities with the same link, don't ask for another relation between them?

  // Get pairs.
  for (var i = 0; i < mentions.length; i++) {
    var m = mentions[i];
    // - Go backwards until you cross a sentence boundary.
    for (var j = i-1; j >= 0; j--) {
      var n = mentions[j];
      if (Math.abs(m.sentenceIdx - n.sentenceIdx) > 0) break;

      // Check that the pair is type compatible and not duplicated.
      if (isRelationCandidate(m,n) && notDuplicated(pairs, m, n)) {
        pairs.push({'subject':m,'object':n});
      }
    }
    // - Go forwards until you cross a sentence boundary.
    for (var j = i+1; j < mentions.length; j++) {
      var n = mentions[j];
      if (Math.abs(m.sentenceIdx - n.sentenceIdx) > 0) break;
      // Check that the pair is type compatible and not duplicated.
      if (isRelationCandidate(m,n) && notDuplicated(pairs, m, n))
        pairs.push({'subject':m,'object':n});
    }
  }
  for (var i = 0; i < pairs.length; i++) {
    pairs[i].id = i;
    pairs[i].relation = null; // The none relation.
  }

  return pairs;
}

function centerOnMention(m) {
  var sentence = $(m.elem).parent();
  var elem = null;
  if (sentence.prev().length > 0) {
    elem = sentence.prev()[0];
//.scrollIntoView(true);
  } else {
    elem = sentence[0];
//.scrollIntoView(true);
  }
    var topPosRel = elem.offsetTop;
    console.log(topPosRel);
    var parentPosRel = $('#document')[0].offsetTop;
    console.log(parentPosRel);
    $('#document').scrollTop(topPosRel - parentPosRel);
}

function centerOnMentionPair(p) {
  if (p.subject.doc_char_begin < p.object.doc_char_begin)
    centerOnMention(p.subject);
  else
    centerOnMention(p.object);
}

// Draw mention pair
RelationInterface.prototype.select = function(mentionPair) {
  // Move to the location.
  centerOnMentionPair(mentionPair);
  mentionPair.subject.tokens.forEach(function(t) {$(t).addClass("subject highlight");});
  mentionPair.object.tokens.forEach(function(t) {$(t).addClass("object highlight");});
  $(mentionPair.subject.elem).parent().addClass("highlight");

}

RelationInterface.prototype.unselect = function(mentionPair) {
  mentionPair.subject.tokens.forEach(function(t) {$(t).removeClass("subject highlight");});
  mentionPair.object.tokens.forEach(function(t) {$(t).removeClass("object highlight");});
  $(mentionPair.subject.elem).parent().removeClass("highlight");
}

RelationInterface.prototype.highlightExistingMentionPair = function(mentionPair) {
  this.unselect(this.mentionPair);
  this.select(mentionPair);
}
RelationInterface.prototype.unhighlightExistingMentionPair = function(mentionPair) {
  this.unselect(mentionPair);
  this.select(this.mentionPair);
}
RelationInterface.prototype.editExistingMentionPair = function(mentionPair) {
  this.unselect(this.mentionPair);
  if (this.viewStack.length == 0) this.viewStack.push(this.currentIndex);
  this.next(mentionPair.id);
}


// Progress to the next mention pair.
RelationInterface.prototype.next = function(idx) {
  var self = this;

  if (idx != null) {
    this.currentIndex = idx;
  } else if (this.viewStack.length > 0) {
    this.currentIndex = this.viewStack.pop();
  } else {
    this.currentIndex += 1;
  }
  if (this.currentIndex > 0) {
    $("#back")[0].disabled = false;
  } else {
    $("#back")[0].disabled = true;
  }
  if (this.currentIndex > this.mentionPairs.length - 1) {
    return this.done();
  } else {
    $("#relation-row").removeClass("hidden");
  }
  var mentionPair = this.mentionPairs[this.currentIndex];

  this.mentionPair = mentionPair;
  this.select(mentionPair);
  this.relnWidget.init(mentionPair, function(reln) {
    self.unselect(mentionPair);

    // Remove a previous relation from the list if it existed.
    if (mentionPair.relation && mentionPair.relation.name != reln.name) {
      self.listWidget.removeRelation(mentionPair);
    } 
    if (mentionPair.relation && mentionPair.relation.name == reln.name) {
    } else {
      // Set the relation of the pair.
      mentionPair.relation = reln;
      // Add mention to the relationList widget.
      if (reln.name != "no_relation") {
        self.listWidget.addRelation(mentionPair);
      }
    }

    self.next();
  }, this.verify);
}

// Called when the interface is done.
RelationInterface.prototype.done = function() {
  // Hide the relation panel, and show the Done > (submit) button.
  $("#done")[0].disabled = false;
  $("#relation-row").addClass("hidden");
}

RelationListWidget = function(elem) {
  this.elem = elem;
}

RelationListWidget.prototype.mouseEnterListeners = [];
RelationListWidget.prototype.mouseLeaveListeners = [];
RelationListWidget.prototype.clickListeners = [];

RelationListWidget.prototype.addRelation = function(mentionPair) {
  var self = this;

  // Make sure that #empty-extraction is hidden.
  this.elem.find("#extraction-empty").addClass("hidden");

  // Create a new relation to add to the list.
  var div = this.elem.find("#extraction-template").clone();
  div.find(".relation-sentence").html(mentionPair.relation.renderTemplate(mentionPair));
  div.removeClass("hidden");
  div.attr("id", "mention-pair-" + mentionPair.id);
  div[0].mentionPair = mentionPair;

  // attach listeners.
  div.on("mouseenter.kbpo.list", function(evt) {
    //console.log("mention.mouseenter", mentionPair);
    self.mouseEnterListeners.forEach(function(cb) {cb(mentionPair);});
  });
  div.on("mouseleave.kbpo.list", function(evt) {
    //console.log("mention.mouseleave", mentionPair);
    self.mouseLeaveListeners.forEach(function(cb) {cb(mentionPair);});
  });
  div.on("click.kbpo.click", function(evt) {
    //console.log("mention.cancel", mentionPair);
    self.clickListeners.forEach(function(cb) {cb(mentionPair);});
  });

  this.elem.append(div);
  return true;
}

RelationListWidget.prototype.removeRelation = function(mentionPair) {
  this.elem.find(".extraction")
    .filter(function (_, e) {
      return e.mentionPair !== undefined && e.mentionPair.id == mentionPair.id;})
    .remove();
  if (this.elem.find(".extraction").length == 2) {
    this.elem.find("#extraction-empty").removeClass("hidden");
  }
}

RelationListWidget.prototype.relations = function() {
  return this.elem.find(".extraction").not("#extraction-empty").not("#extraction-template");
}


// TODO: Allow for keyboard shortcuts.
