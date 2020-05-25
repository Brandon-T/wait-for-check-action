import * as core from '@actions/core'
import { GitHub } from '@actions/github'
import { context } from '@actions/github'

type ActionResult = { id: number; name: string; status: string; conclusion: string; }

const valid_statuses = ["queued", "in_progress", "completed"] as const;
const valid_conclusions = ["success", "failure", "neutral", "cancelled", "timed_out", "action_required"] as const;
type Status = typeof valid_statuses[number]
type Conclusion = typeof valid_conclusions[number]

function IsValidStatus(status: string): status is Status {
    return valid_statuses.find(item => { return item === status }) != null
}

function IsValidConclusion(conclusion: string): conclusion is Conclusion {
    return valid_conclusions.find(item => { return item === conclusion }) != null
}

function IsValidJson(str: string): boolean {
    try {
        JSON.parse(str)
    } catch (e) {
        return false
    }
    return true
}

function NormalizeResponse(names: string[], check_runs: {id: number; name: string; status: string; conclusion: string;}[]): ActionResult[] {
    var response: ActionResult[] = []
    var data = check_runs.map(element => {
        return {
            id: element.id,
            name: element.name,
            status: element.status,
            conclusion: element.conclusion
        }
    });

    for (var i = 0; i < names.length; ++i) {
        var found = false;
        data = data.filter(item => {
            if (!found && item.name == names[i]) {
                response.push(item);
                found = true;
                return false;
            }
            return true;
        })
    }

    return response
}

async function wait_for(milliseconds: number): Promise<void> {
    return new Promise(function (resolve, reject) {
        if (isNaN(milliseconds) || milliseconds <= 0) {
            reject('Invalid time')
            return
        }
        
        setTimeout(() => { resolve() }, milliseconds)
    })
}

async function check(token: string, owner: string, repo: string, ref: string, names: [string], statuses: [string], poll_interval: number, timeout: number): Promise<any> {
    let now = new Date().getTime()
    const expiredTime = new Date().getTime() + (timeout * 1000);
    const client = new GitHub(token)

    while (now <= expiredTime) {
        const response = await client.checks.listForRef({
            owner: owner,
            repo: repo,
            ref: ref
        })

        if (response.data.total_count >= names.length) {
            const check_runs = response.data.check_runs.filter(item => {
                return names.find(element => element == item.name)
            })

            const result = check_runs.map(element => {
                return {
                    id: element.id,
                    name: element.name,
                    status: element.status,
                    conclusion: element.conclusion
                }
            })

            console.log(`Retrieved: ${ JSON.stringify(result.map(item => { return { name: item.name, status: item.status } })) }`);
            
            if (statuses.length > 0) {
                const normalized_resposne = NormalizeResponse(names, check_runs)

                const did_all_complete = normalized_resposne.length === statuses.length && normalized_resposne.every((value, index) => {
                    return value.status === statuses[index]
                })
                
                if (did_all_complete) {
                    console.log('All check-runs are completed.')
                    return normalized_resposne
                }
            }
            else {
                const normalized_resposne = NormalizeResponse(names, check_runs)
                const did_all_complete = normalized_resposne.every(value => {
                    return value.status === "completed"
                })
                
                if (did_all_complete) {
                    console.log('All check-runs are completed.')
                    return normalized_resposne
                }
            }
        }
        
        console.log(`Time Remaining: ${ (expiredTime - now) / 1000 }`)
        console.log(`Waiting for: ${ poll_interval }s before trying again.`)

        await wait_for(poll_interval * 1000)
        now = new Date().getTime()
    }
    return null
}

function GetStringArray(input: string, is_required: boolean): string[] | undefined {
    let values = core.getInput(input, { required: is_required })
    if (values != null && typeof values === 'string' && !IsValidJson(values)) {
        values = `[${ values }]`
    }

    if (values == null) {
        values = '[]'
    }

    if (!IsValidJson(values)) {
        return undefined
    }

    let res = JSON.parse(values)
    if (!Array.isArray(res) || !res.every(item => typeof item === 'string')) {
        return undefined
    }
    return res as [string]
}

async function main(): Promise<void> {
    try {
        const raw_names = GetStringArray('check_names', true)
        const raw_statuses = GetStringArray('statuses', false)
        const raw_conclusions = GetStringArray('conclusions', false)
        
        if (raw_names == null || raw_statuses == null || raw_conclusions == null) {
            core.setFailed("Invalid Input for check_names or statuses or conclusions.")
            return
        }

        const token = core.getInput('github_token', { required: true })
        const check_names = raw_names as string[]
        const statuses = raw_statuses as string[]
        const conclusions = raw_conclusions as string[]
        const owner = core.getInput('owner') || context.repo.owner
        const repo = core.getInput('repo') || context.repo.repo
        const ref = core.getInput('ref') || context.ref
        const timeout = parseInt(core.getInput('timeout') || '300')
        const poll_interval = parseInt(core.getInput('poll_interval') || '10')

        if (check_names.length <= 0) {
            core.setFailed('ERROR: check_names must be an array of strings.')
            return
        }

        if (statuses.length > 0 && !statuses.every(item => { return IsValidStatus(item) })) {
            core.setFailed('ERROR: statuses must be an array of valid status strings.')
            return
        }

        if (conclusions.length > 0 && !conclusions.every(item => { return IsValidConclusion(item) })) {
            core.setFailed('ERROR: conclusions must be an array of valid conclusion strings or empty.')
            return
        }

        if (statuses.length > 0 && statuses.length != check_names.length) {
            core.setFailed('ERROR: amount of statuses do not match amount of check_names.')
            return
        }

        if (conclusions.length > 0 && conclusions.length != check_names.length) {
            core.setFailed('ERROR: amount of conclusions do not match amount of check_names.')
            return
        }

        const result = await check(
            token,
            owner,
            repo,
            ref,
            check_names as [string],
            statuses as [string],
            poll_interval,
            timeout
        )

        if (result == null) {
            core.setFailed('ERROR: timed-out.')
            return
        }

        const output = result as ActionResult[]

        if (conclusions.length > 0 && !output.every((value, index) => { return value.conclusion === conclusions[index] })) {
            core.setOutput('result', output)
            core.setOutput('ids', output.map(item => { return item.id }))
            core.setOutput('names', output.map(item => { return item.name }))
            core.setOutput('statuses', output.map(item => { return item.status }))
            core.setOutput('conclusions', output.map(item => { return item.conclusion }))
            core.setFailed('ERROR: Conclusion failure.')
            return
        }

        core.setOutput('result', output)
        core.setOutput('ids', output.map(item => { return item.id }))
        core.setOutput('names', output.map(item => { return item.name }))
        core.setOutput('statuses', output.map(item => { return item.status }))
        core.setOutput('conclusions', output.map(item => { return item.conclusion }))
    } catch (error) {
        core.setFailed(error.message)
    }
}

main()