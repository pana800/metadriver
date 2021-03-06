const neeoapi = require('neeo-sdk');
const { JSONPath } = require('jsonpath/lib');
const jpath = require('jsonpath');

class directoryHelper {
  constructor(controller) {
    this.feederH = [];
    this.browseHistory = []
    this.currentFeederIndex = 0;
    this.controller = controller;
    this.previousOffset = 0; //check if we were scrolling;
    var self = this;
    this.addFeederHelper = function (feedConfig) {
      self.feederH.push(feedConfig);
    };
    this.browse = {
      getter: (deviceId, params) => this.fetchList(deviceId, params),
      action: (deviceId, params) => this.handleAction(deviceId, params),
    };

    this.evalNext = function (evalnext, result) {
      if (evalnext) { //case we want to go to another feeder
        evalnext.forEach(evalN => {
          if (evalN.test == '' || evalN.test == true) {evalN.test = true}; //in case of no test, go to the do function
          let finalNextTest = self.controller.readVariables(evalN.test);// prepare the test to assign variable and be evaluated.
          console.log('test')
          finalNextTest = self.controller.assignResult(finalNextTest, result);
          console.log('test2')
          if (finalNextTest) {
            if (evalN.then && evalN.then != '')
            {
              self.currentFeederIndex = self.feederH.findIndex((feed) => {return (feed.name == evalN.then)});
            }
          }
          else { 
            if (evalN.or && evalN.or != '')
            {
              self.currentFeederIndex = self.feederH.findIndex((feed) => {return (feed.name == evalN.or)});
            }
          }
         })
      }
    }

    this.fetchList = function (deviceId, params) { //browse management and delegation to feeders. to be refactored later>
      return new Promise(function (resolve, reject) {
      if (params.browseIdentifier != '') { //case were a directory was selected in the list
        console.log('browsing forward')
        //Take the good feeder:
        //Take the good commandset:
        let commandSetIndex = params.browseIdentifier.split("$CommandSet=")[1];
        params.browseIdentifier = params.browseIdentifier.split("$CommandSet=")[0];
        self.controller.evalWrite(self.feederH[self.currentFeederIndex].commandset[commandSetIndex].evalwrite, params.browseIdentifier, deviceId);
        self.evalNext(self.feederH[self.currentFeederIndex].commandset[commandSetIndex].evalnext, params.browseIdentifier);//assign the good value to know the feeder
      }
      else if (params.history.length>0 && params.offset==0 && self.previousOffset == 0) {//case where we browse backward
        console.log('browsing backward')
        console.log(params.history.length)
        console.log(self.browseHistory.length)
        console.log(self.browseHistory)
        self.currentFeederIndex = self.browseHistory[params.history.length];
        console.log('current feeder' + self.currentFeederIndex)
      }
      else if ( params.offset>0) {
        console.log ('scrolling')
        self.previousOffset = params.offset;
      }
      else if ( params.offset==0 && self.previousOffset > 0) {//we were scrolling and get back to begining of list either by up scroll or back button
        self.previousOffset = 0;
      }
      else {
        console.log ('browsing initiation')
        self.currentFeederIndex = 0
      } // beginning

      if (self.browseHistory.length<params.history.length) {
        self.browseHistory.push(self.currentFeederIndex) //memorize the path of browsing for feeder 
      }
      else {self.browseHistory[params.history.length] = self.currentFeederIndex}


      console.log('my browse feeder history : ' + self.browseHistory )

      self.fetchCurrentList(deviceId, self.feederH[self.currentFeederIndex], params)
          .then((list) => { resolve(list); })
          .catch((err) => { reject(err); });
      });
    };

    this.fetchCurrentList = function (deviceId, allconfigs, params) {
      console.log("params: " + JSON.stringify(params));
      console.log("browseIdentifier: " + params.browseIdentifier);
      console.log("actionIdentifier: " + params.actionIdentifier);
      console.log("current feeder: " + self.currentFeederIndex);
      let cacheList = [];
      return new Promise(function (resolve, reject) {
        
        self.fillTheList(cacheList, allconfigs, params, 0, 0).then((cacheList) => {
            //console.log(cacheList);
            //Feed the neeo list
            let neeoList;
            neeoList = neeoapi.buildBrowseList({
              title: allconfigs.name,
              totalMatchingItems: cacheList.length,
              limit: 64,
              offset: (params.offset || 0),
            });
            var i;
            for (i = (params.offset || 0); (i < ((params.offset || 0) + 64) && (i < cacheList.length)); i++) {
              if (cacheList[i].itemtype == 'tile') {
                let tiles = [];
                tiles.push({
                    thumbnailUri: cacheList[i].image,
                    actionIdentifier: cacheList[i].action,
                    uiAction: 'reload',
                })
                if ((i+1 < cacheList.length) && (cacheList[i+1].itemtype == 'tile')) {
                  //test if the next item is also a tile to put on the right, if it is not the end of the list
                  i++
                  tiles.push({
                    thumbnailUri: cacheList[i].image,
                    actionIdentifier: cacheList[i].action,
                    uiAction: 'reload',
                  });
                }
                neeoList.addListTiles(tiles);
              }
              else {
                neeoList.addListItem({
                  title: cacheList[i].name,
                  label: cacheList[i].label,
                  thumbnailUri: cacheList[i].image,
                  actionIdentifier: cacheList[i].action,
                  browseIdentifier: cacheList[i].browse,
                  uiAction: 'reload',
                });
              }
            }
            //console.log(neeoList)
            resolve(neeoList);
          })
        
      })
    }

    this.fillTheList = function (cacheList, allconfigs, params, indentCommand) {
        let resultList;
        let rAction;
        let rBrowse;
        let rName;
        let rItemType;
        let rImage;
        let rLabel;
        //console.log('fill')
        return new Promise(function (resolve, reject) {
          if (indentCommand < allconfigs.commandset.length) {
            let commandSet = allconfigs.commandset[indentCommand];
            let processedCommand = self.controller.assignResult(commandSet.command, params.browseIdentifier);
            processedCommand = self.controller.readVariables(processedCommand);
            console.log('Final processed Command:' + processedCommand)
            self.controller.commandProcessor(processedCommand, commandSet.type)
              .then((result) => {
                resultList = self.controller.queryProcessor(result, commandSet.queryresult, commandSet.type);
                rName = self.controller.readVariables(commandSet.itemname); //ensure that the item name chain has the variable interpreted (except $Result)
console.log('resultList : ' + resultList)
                rImage = self.controller.readVariables(commandSet.itemimage); 
                rItemType = self.controller.readVariables(commandSet.itemtype); 
                rLabel = self.controller.readVariables(commandSet.itemlabel); 
                rAction = self.controller.readVariables(commandSet.itemaction); 
                rBrowse = self.controller.readVariables(commandSet.itembrowse); 
                resultList.forEach(oneItemResult => { //As in this case, $Result is a table, transform $Result to get every part of the table as one $Result
                  cacheList.push({
                    'name' : self.controller.assignResult(rName, oneItemResult),
                    'image' : self.controller.assignResult(rImage, oneItemResult),
                    'itemtype' : rItemType,
                    'label' : self.controller.assignResult(rLabel, oneItemResult),
                    'action' : self.controller.assignResult(rAction, oneItemResult),
                    'browse' : rBrowse ? self.controller.assignResult(rBrowse, oneItemResult)+"$CommandSet="+indentCommand : rBrowse
                  });//push the result of the itemname expression with result item to the namelist
                });
                resolve(self.fillTheList(cacheList, allconfigs, params, indentCommand + 1));
              })
              .catch(function (err) {
                console.log("Fetching error: " + err);
              });
          }
          else {
            resolve(cacheList);
          }
        })
    }
    
  

    this.handleAction = function (deviceId, params) {
      return new Promise(function (resolve, reject) {
        self.handleCurrentAction(deviceId, self.feederH[self.currentFeederIndex], params)
          .then((action) => { resolve(action); })
          .catch((err) => { reject(err); });
      });
    };

    this.handleCurrentAction = function (deviceId, config, params) {
      console.log(params);
      return new Promise(function (resolve, reject) {
       //here, the action identifier is the result.
        self.controller.commandProcessor(params.actionIdentifier, config.type)
          .then(function (result) { resolve(result) })
          .catch(function (err) { reject(err); });
      });
    };
  }
}
exports.directoryHelper = directoryHelper;
