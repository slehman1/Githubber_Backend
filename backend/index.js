import express from "express";
import cors from "cors"
import { Octokit } from "octokit";
import 'dotenv/config';
import bcrypt from "bcrypt"
import { createClient } from '@supabase/supabase-js'

// maybe you can do some sort of stats comparison app? or leaderboard or something?
// i'm thinking you can query for people's profiles and pull stats around num of lines added/deleted, num of commits, avg commit frequency, etc
// and then compare 2 (or multiple) profiles and see how they match up
// and you could have different leaderboards for different stats
// with all these stats, you could also look into some visualizing tools/packages to spice things up rather than just displaying text



//////////////////////////
const githubAPIEndpoint = 'https://api.github.com/graphql'

const headers = {
    "Content-Type" : "application/json",
    Authorization: "bearer " + process.env.AUTH_KEY
}

// fetch(githubAPIEndpoint, {
//     method: "POST", 
//     headers: headers,
//     body: JSON.stringify({
//         query: `
//         query getInfo($username: String!) {
//             user(login: $username){
//               bio
//               company
//               createdAt
//               email
//               followers{
//                 totalCount
//               }
//               isHireable
//               location
//               name
//               organizations{
//                 totalCount
//               }
//               pullRequests(first: 100){
//                 totalCount
//                 nodes{
//                   createdAt
//                   body
//                 }
//               }
//               starredRepositories{
//                 totalCount
//               }
//               repositories(first: 100){
//                 totalCount
//                 nodes{
//                   createdAt
//                   name
//                   defaultBranchRef{
//                     target{
//                       ... on Commit {
//                         history {
//                           totalCount
//                           nodes{
//                             committedDate
//                             additions
//                             deletions
//                           }
//                         }
//                       }
//                     }
//                   }
//                 }
                
//               }
//             }
//           }
//         `,
//         variables: {"username": "rsn55"} 
//     }),

// }).then(res =>  res.json()).then(data => console.log(data)).catch(err => console.log(err))




/////////////







//octokit simplifies github api calls
const octokit = new Octokit({ auth: process.env.AUTH_KEY });

//supabase db server hosting
const supabaseUrl = 'https://btsemxwskradoknjgqau.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

//config express
const port = 8080
const app = express()
app.use(cors())
app.use(express.json()) 
app.use(express.urlencoded({ extended: true }))

app.get("/", (req, res) => {
    res.json("Hello")
})

//compare metrics between two users route
app.post("/compare", async (req, res) => {
    const {user1, user2} = req.body
    const threeMonths = 3 * 30 * 24 * 60 * 60 * 1000 
    const threeMonthRange = Date.now() - threeMonths
    const resArray = []
    const userz1Data = await userStats(user1, threeMonthRange)
    const userz2Data = await userStats(user2, threeMonthRange)
    resArray.push(userz1Data)
    resArray.push(userz2Data)
    res.json(resArray)
})

//get logged in user info
app.post("/user", async (req, res) => {
    const {username} = req.body
    const userz1Data = await userStats(username)
    console.log(userz1Data)
    res.json(userz1Data)
})


//gets a list of repo names from the user
app.post("/repos", async (req, res) => {
    const user = req.body.user1
    if (user === ""){
        res.json("Error")
        return
    }

    fetch(githubAPIEndpoint, {
    method: "POST", 
    headers: headers,
    body: JSON.stringify({
        query: `
        query getRepos($username: String!) {
            user(login: $username){
              repositories(first: 100){
                totalCount
                nodes{
                  owner {
                    login
                  }
                  createdAt
                  name
                }
              }
            }
          }
        `,
        variables: {"username": user} 
    })})
    .then(res =>  res.json())
    .then(data => {
        const repos = data.data.user.repositories.nodes
        const resFilter = repos.filter((repo) => repo.owner.login === user)
        const resArray = resFilter.map((repo) => repo.name)
        res.json(resArray)
    })
    .catch(err => console.log(err))

})

//get info of interest for a specific repo
app.post("/repoInfo", async (req, res) => {
    const {user1, repo} = req.body

    //get bytes per language and repo info and line counts
    fetch(githubAPIEndpoint, {
        method: "POST", 
        headers: headers,
        body: JSON.stringify({
            query: `
            query getRepoInfo($username: String!, $repo: String!) {
                user(login: $username){
                  repository(name: $repo){
                    forkCount
                    stargazerCount
                    issues{
                      totalCount
                    }
                        languages(first: 100){
                      totalSize
                      edges{
                        node{
                          name
                        }
                        size
                      }
                    }
                    defaultBranchRef{
                        target{
                          ... on Commit {
                            history {
                              totalCount
                              nodes{
                                committedDate
                                additions
                                deletions
                              }
                            }
                          }
                        }
                      }
                      
                    }
                  }
                }
            `,
            variables: {"username": user1, repo: repo} 
        })})
        .then(res =>  res.json())
        .then(data => {
            const repository = data.data.user.repository
            //package to send
            const repoInfo = {
                forks: repository.forkCount,
                stars: repository.stargazerCount,
                openIssues: repository.issues.totalCount,
            }
            const repoLanguageDict = {}
            repository.languages.edges.forEach((language) => {
                repoLanguageDict[language.node.name] = language.size
            })
            //get lines
            const threeMonths = 3 * 30 * 24 * 60 * 60 * 1000 
            const threeMonthRange = Date.now() - threeMonths
            const linesRes = linesHelper(repository.defaultBranchRef, threeMonthRange)
            const resData = {
            languages: repoLanguageDict,
            lineNums: linesRes.linesArray,
            info: repoInfo
            }
            res.json(resData)
        })
        .catch(err => console.log(err))
})

//login route
app.post("/login", async (req, res) => {
    const {username, password} = req.body
    try {
        const { data, error } = await supabase
            .from('users')
            .select()
            .eq('username', username)

        bcrypt.compare(password, data[0].hashed_password, function(err, result) {
        if (result) {
            res.json({id: data[0].id, username: username })
        } else {
            res.send("Wrong")
        }
    });
    } catch {
        res.send("None")
    }
})

//register route
app.post("/register", async (req, res) => {
    const {username, password} = req.body
    //check if username already in use
    const { data, error } = await supabase
        .from('users')
        .select()
        .eq('username', username)
    if (data.length > 0) {
        res.send("Username")
    } else {
        //hash password with bcrypt
        const saltRounds = 10
        bcrypt.genSalt(saltRounds, async function(err, salt) {
            bcrypt.hash(password, salt, async function(err, hash) {
                const { error } = await supabase
                    .from('users')
                    .insert({ username: username, hashed_password: hash })
                    console.log(error)
                    if (error) {
                        res.send("Error")
                    } else {
                        res.send("Success")
                    }
            });
        });  
    }
})

app.listen(port, () => {
    console.log("listening on port 8080")
});


//takes in a username and returns an object with desired info
async function userStats(username, rangeEpoch){

    return fetch(githubAPIEndpoint, {
        method: "POST", 
        headers: headers,
        body: JSON.stringify({
            query: `
            query getInfo($username: String!) {
                user(login: $username){
                  issues{
                    totalCount
                  }
                  bio
                  company
                  createdAt
                  email
                  followers{
                    totalCount
                  }
                  isHireable
                  location
                  name
                  organizations{
                    totalCount
                  }
                  pullRequests(first: 100){
                    totalCount
                    nodes{
                      createdAt
                      # body
                    }
                  }
                  starredRepositories{
                    nodes{
                      url
                      name
                      createdAt
                    }
                    totalCount
                    
                  }
                  repositories(first: 100){
                    totalCount
                    nodes {
                      owner {
                        login
                      }
                      stargazerCount
                      stargazers(first: 100){
                        nodes{
                          createdAt
                          name
                        }
                        totalCount
                      }
                      name
                      createdAt
                      languages(first: 100){
                      edges{
                        node{
                          name
                        }
                        size
                      }
                    }
                      defaultBranchRef{
                        target{
                          ... on Commit {
                            history {
                              totalCount
                              nodes{
                                committedDate
                                additions
                                deletions
                              }
                            }
                          }
                        }
                      }
                    }
                    
                  }
                }
              }
            
            `,
            variables: {"username": username} 
        })})
        .then(res =>  res.json())
        .then(data => {
            const userData = data.data.user
            const threeMonths = 3 * 30 * 24 * 60 * 60 * 1000 
            const threeMonthRange = Date.now() - threeMonths
            var totalLines = 0
            var recentLines = 0
            var totalStars = 0
            var recentStars = 0
            var recentRepos = 0
            var totalCommits = 0
            var recentCommits = 0
            var recentPRs = 0
            const languageDict = {}
            //gonna do language bytes only for the repos that you own

            //calculate recent prs
            userData.pullRequests.nodes.forEach(pr => {
                const prDate = new Date(pr.createdAt).getTime()
                if (prDate > threeMonthRange) {
                    recentPRs += 1
                }

            })
            //


            //loop through commits to get lines added and deleted 
            userData.repositories.nodes.forEach((repo) => {
                const linesHelperRes = linesHelper(repo.defaultBranchRef, threeMonthRange)
                totalLines += linesHelperRes.linesArray[linesHelperRes.linesArray.length - 1]
                recentLines += linesHelperRes.recentLines
                totalStars += repo.stargazerCount
                const repoCreateDate = new Date(repo.createdAt).getTime()
                if (repoCreateDate > threeMonthRange){
                    recentRepos += 1
                }
                repo.stargazers.nodes.forEach((stargazer) => {
                    const starDate = new Date(stargazer.createdAt).getTime()
                    if (starDate > threeMonthRange) {
                        recentStars += 1
                    }
                })
                //languages
                const repoLanguages = repo.languages.edges
                repoLanguages.forEach(repo => {
                    if (repo.node.name in languageDict) {
                        languageDict[repo.node.name] += repo.size
                    } else {
                        languageDict[repo.node.name] = repo.size
                    }
                })
                const commits = repo.defaultBranchRef.target.history.nodes
                commits.forEach(commit => {
                    totalCommits += 1
                    const commitDate = new Date(commit.committedDate).getTime()
                    if (commitDate > threeMonthRange){
                        recentCommits += 1
                    }
                })

            })
            
            const userReturnData = {
                total: {
                    user: username,
                    stars: totalStars,
                    commits: totalCommits,
                    prs: userData.pullRequests.totalCount,
                    lines: totalLines,
                    repoCount: userData.repositories.totalCount,
                    openIssues: userData.issues.totalCount,
                    languageDict: languageDict,
        
                }, 
                recent: {
                    user: username,
                    stars: recentStars,
                    commits: recentCommits,
                    prs: recentPRs,
                    lines: recentLines,
                    repoCount: recentRepos
                }
            }
            // console.log(userReturnData)
            

            return userReturnData

        })
        .catch(err => console.log(err))



}


function linesHelper(data, rangeDate){
    //get all commmits and then get lines added and deleted per commit
    //return an array of the lines over time as well as a total line number for the repo that is recent
    const commits = data.target.history.nodes
    const linesArray = []
    var recentLines = 0
    var z = 0
    for (let i = commits.length - 1; i > -1; i--){
        z += 1
        const currCommit = commits[i]
        const change = currCommit.additions - currCommit.deletions
        
        const commitDate = new Date(currCommit.committedDate).getTime()
        if (commitDate > rangeDate) {
            recentLines += change
        }
        if (i === commits.length - 1){
            linesArray.push(change)
        } else {
            linesArray.push(change + linesArray[z - 2])
        }
    }
    const returnObj = {
        linesArray: linesArray,
        recentLines: recentLines
    }
    return returnObj

}