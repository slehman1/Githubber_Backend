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
    // console.log(userz1Data)
    res.json(userz1Data)
})


//gets a list of repo names from the user

app.post("/repos", async (req, res) => {
    const user = req.body.user1
    if (user === ""){
        res.json("Error")
        return
    }
    
    const user1Repos = await octokit.request("GET /users/{username}/repos", {
        username: user,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    
    const resData = []
    user1Repos.data.forEach(repo => {
        resData.push(repo.name)
    })
    res.json(resData)
})

//get info of interest for a specific repo
app.post("/repoInfo", async (req, res) => {
    const {user1, repo} = req.body

    //get bytes per language
    const repoLanguages = await octokit.request('GET /repos/{owner}/{repo}/languages', {
        owner: user1,
        repo: repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    
    //get lines
    const threeMonths = 3 * 30 * 24 * 60 * 60 * 1000 
    const threeMonthRange = Date.now() - threeMonths
    const linesRes = await getLines(user1, repo, threeMonthRange)
    const linesArray = linesRes.linesArray

    //get repo info
    const repoInfoResponse = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: user1,
        repo: repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    })

    //package to send
    const repoInfo = {
        forks: repoInfoResponse.data.forks,
        stars: repoInfoResponse.data.stargazers_count,
        openIssues: repoInfoResponse.data.open_issues,
    }
    const resData = {
        languages: repoLanguages.data,
        lineNums: linesArray,
        info: repoInfo
    }
    res.json(resData)
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
    //get all their repositories
    const user1Repos = await octokit.request("GET /users/{username}/repos", {
        username: username,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    var user1stars = 0
    var user1OpenIssues = 0
    var recentRepos = 0
    user1Repos.data.forEach((repo) => {
        const repoDate = new Date(repo.created_at).getTime()
            if (repoDate > rangeEpoch) {
                recentRepos += 1
            }
        const openIssue = repo.open_issues
        const stars = repo.stargazers_count
        user1OpenIssues += openIssue
        user1stars += stars
    })

    //calculate languages
    const languageDict1 = {}
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const user1Languages = await octokit.request('GET /repos/{owner}/{repo}/languages', {
            owner: username,
            repo: repoName,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        
        for (var key in user1Languages.data){
            if (key in languageDict1){
                languageDict1[key] = languageDict1[key] + user1Languages.data[key]
            } else {
                languageDict1[key] = user1Languages.data[key]
            }
        }
    }
    
    //calculate commits for each repo
    var userCommits = 0
    var userRecentCommits = 0
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const user1commitsResponse = await octokit.request('GET /repos/{owner}/{repo}/commits?author={owner}', {
            owner: username,
            repo: repoName,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        user1commitsResponse.data.forEach((commits) => {
            const commitDate = new Date(commits.commit.committer.date).getTime()
            if (commitDate > rangeEpoch) {
                userRecentCommits += 1
            }
        })
        userCommits += user1commitsResponse.data.length
    }
    
    //calculate pulls
    var userPRs = 0
    var userPRsRecent = 0
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const user1PullsResponse = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
            owner: username,
            repo: repoName,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        //check within epoch range
        user1PullsResponse.data.forEach((pull) => {
            const pullDate = pull.created_at
            const pullEpoch = new Date(pullDate)
            if (pullEpoch > rangeEpoch){
                userPRsRecent += 1
            }
        })
        userPRs += user1PullsResponse.data.length
    }
    //calculate lines through the commits of each repo
    var userLines = 0
    const threeMonths = 3 * 30 * 24 * 60 * 60 * 1000 
    const threeMonthRange = Date.now() - threeMonths
    var recentLines = 0
    for (let i = 0; i < user1Repos.data.length; i++){
        const repoName = user1Repos.data[i].name
        const rez = await getLines(username, repoName, threeMonthRange)
        const repoLines = rez.linesArray[rez.linesArray.length - 1]
        userLines += repoLines
        recentLines += rez.recentLines
    }
    
    
    const user1Data = {
        total: {
            user: username,
            stars: user1stars,
            commits: userCommits,
            prs: userPRs,
            lines: userLines,
            repoCount: user1Repos.data.length,
            openIssues: user1OpenIssues,
            languageDict: languageDict1,

        }, 
        recent: {
            user: username,
            stars: user1stars,
            commits: userRecentCommits,
            prs: userPRsRecent,
            lines: recentLines,
            repoCount: recentRepos,
        }
    }
    
    return user1Data


}

async function getLines(owner, repo, recentRange){
    //get all commmits and then get lines added and deleted per commit
    //return an array of the lines over time as well as a total line number for the repo that is recent
    const userCommits = await octokit.request('GET /repos/{owner}/{repo}/commits', {
        owner: owner,
        repo: repo,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
    })
    const commitShas = []
    userCommits.data.forEach((commit) => {
        commitShas.push(commit.sha)
    })
    var currLines = 0
    const linesArray = []
    var z = 0
    var recentLines = 0;
    for (let i = commitShas.length - 1; i > -1; i--){
        z += 1
        const currSha = commitShas[i]
        const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{sha}', {
            owner: owner,
            repo: repo,
            sha: currSha,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        const commitDate = new Date(response.data.commit.committer.date).getTime()
        const change = response.data.stats.additions - response.data.stats.deletions
        //add change if within recent range
        if (commitDate > recentRange) {
            recentLines += change
        }
        if (i === commitShas.length - 1){
            linesArray.push(change)
        } else {
            const prevLines = linesArray[z - 2]
            const newTotal = prevLines + change
            linesArray.push(newTotal)
        }
    }
    const returnObj = {
        linesArray: linesArray,
        recentLines: recentLines
    }
    return returnObj
}